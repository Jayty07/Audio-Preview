/**
 * File Picker Audio Preview
 * ---------------------------------------------------------------------------
 * Adds a play / stop button to every audio file listed in Foundry VTT's file
 * browser (the FilePicker), so you can listen to a sound before picking it.
 *
 * Compatible with:
 *  - Foundry VTT v12  (Application v1 FilePicker; render hooks pass jQuery)
 *  - Foundry VTT v13  (ApplicationV2 FilePicker; render hooks pass an HTMLElement)
 *  - The Forge        (its FilePicker subclass keeps Foundry's templates, so the
 *                      Assets Library, Bazaar, S3 and core sources all list files
 *                      as <li class="file" data-path="...">)
 *
 * Playback uses a plain HTMLAudioElement in your own browser only: nothing is
 * broadcast to other players.
 */

const MODULE_ID = "filepicker-audio-preview";

/** Every file row in the v12 and v13 FilePicker templates. */
const ROW_SELECTOR = "li.file[data-path]";

/** Audio formats Foundry accepts but browsers cannot play natively. */
const UNPLAYABLE_EXTENSIONS = new Set(["mid", "midi"]);

/** Icon + label for each button state. */
const BUTTON_STATES = {
  idle: { icon: "fas fa-play", label: "Play" },
  loading: { icon: "fas fa-circle-notch fa-spin", label: "Stop" },
  playing: { icon: "fas fa-stop", label: "Stop" },
  unsupported: { icon: "fas fa-volume-xmark", label: "UnsupportedShort" }
};

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function localize(key, data) {
  const id = `FPAP.${key}`;
  return data ? game.i18n.format(id, data) : game.i18n.localize(id);
}

function getSetting(key) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return undefined;
  }
}

/** Unwrap an element from v12 (jQuery) or v13 (HTMLElement) render hook arguments. */
function toElement(value) {
  if (value instanceof HTMLElement) return value;
  if (value?.[0] instanceof HTMLElement) return value[0];
  return null;
}

/** The persistent outer element of an application window, in v12 or v13. */
const getAppElement = (app) => toElement(app?.element);

function hasKey(collection, key) {
  if (!collection) return false;
  if (Array.isArray(collection)) return collection.includes(key);
  return Object.prototype.hasOwnProperty.call(collection, key);
}

/** Lower-case extension of a path or URL, ignoring any query string or hash. */
function getExtension(path) {
  const file = String(path ?? "").split(/[?#]/)[0].split("/").pop() ?? "";
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
}

/** Should this file get a preview button? */
function isAudioFile(path, app) {
  const ext = getExtension(path);
  if (!ext || !hasKey(CONST.AUDIO_FILE_EXTENSIONS, ext)) return false;
  // Extensions shared with video (.webm) are shown by Foundry as videos, so only
  // treat them as audio when the picker is filtered to audio files.
  if (hasKey(CONST.VIDEO_FILE_EXTENSIONS, ext) && app?.type !== "audio") return false;
  return true;
}

function displayName(li) {
  if (li?.dataset.name) return li.dataset.name;
  const file = String(li?.dataset.path ?? "").split(/[?#]/)[0].split("/").pop() ?? "";
  try {
    return decodeURIComponent(file);
  } catch {
    return file;
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Preview volume, using Foundry's own slider curve, optionally scaled by the Interface volume. */
function computeVolume() {
  let input = Number(getSetting("volume"));
  if (!Number.isFinite(input)) input = 0.5;
  input = clamp(input, 0, 1);

  const toVolume = globalThis.foundry?.audio?.AudioHelper?.inputToVolume;
  let volume = typeof toVolume === "function" ? toVolume(input) : input ** 1.5;

  if (getSetting("useInterfaceVolume")) {
    let interfaceVolume = 1;
    try {
      interfaceVolume = Number(game.settings.get("core", "globalInterfaceVolume"));
    } catch {
      interfaceVolume = 1;
    }
    if (Number.isFinite(interfaceVolume)) volume *= interfaceVolume;
  }
  return Number.isFinite(volume) ? clamp(volume, 0, 1) : 0.5;
}

/** Stop an event from reaching Foundry's own file-picking handlers. */
function swallow(event) {
  event.preventDefault();
  event.stopPropagation();
}

function setButtonState(button, state) {
  if (button.dataset.state === state) return;
  const config = BUTTON_STATES[state] ?? BUTTON_STATES.idle;
  const label = localize(config.label);
  button.dataset.state = state;
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);
  let icon = button.querySelector("i");
  if (!icon) {
    icon = document.createElement("i");
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
  }
  icon.className = config.icon;
}

/* -------------------------------------------- */
/*  Preview player                              */
/* -------------------------------------------- */

/** Plays one preview at a time and keeps its row in the file list up to date. */
class PreviewPlayer {
  /** @type {HTMLAudioElement|null} */
  audio = null;

  /** data-path of the file being previewed. */
  path = null;

  /** The FilePicker the preview was started from. */
  app = null;

  /** The <li> row currently showing the playback UI. */
  row = null;

  name = "";

  /** "idle" | "loading" | "playing" */
  state = "idle";

  #frame = null;

  #bar = null;

  #time = null;

  isActive(path, app) {
    return !!this.audio && this.path === path && this.app === app;
  }

  toggle(li, app) {
    if (this.isActive(li.dataset.path, app)) this.stop();
    else this.play(li, app);
  }

  play(li, app) {
    const path = li.dataset.path;
    const name = displayName(li);
    if (UNPLAYABLE_EXTENSIONS.has(getExtension(path))) {
      ui.notifications?.warn(localize("Unsupported", { name }));
      return;
    }
    this.stop();

    const audio = new Audio();
    audio.preload = "auto";
    audio.loop = !!getSetting("loop");
    audio.volume = computeVolume();

    this.audio = audio;
    this.path = path;
    this.app = app;
    this.name = name;
    this.state = "loading";

    const isCurrent = () => this.audio === audio;
    audio.addEventListener("playing", () => isCurrent() && this.#setState("playing"));
    audio.addEventListener("waiting", () => isCurrent() && this.#setState("loading"));
    audio.addEventListener("ended", () => {
      if (isCurrent() && !audio.loop) this.stop();
    });
    audio.addEventListener("error", () => this.#fail(audio, audio.error));

    this.adoptRow(li);
    audio.src = path;
    const started = audio.play();
    started?.catch?.((err) => {
      if (err?.name === "AbortError") return; // Stopped or replaced before playback began.
      this.#fail(audio, err);
    });
    this.#startTicker();
  }

  stop() {
    const audio = this.audio;
    if (!audio) return;
    this.audio = null;
    this.#stopTicker();
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load(); // Cancels any download still in progress.
    } catch (err) {
      console.debug(`${MODULE_ID} | Error while stopping preview`, err);
    }
    this.#releaseRow();
    this.path = null;
    this.app = null;
    this.name = "";
    this.state = "idle";
  }

  stopIfOwnedBy(app) {
    if (this.audio && this.app === app) this.stop();
  }

  applyVolume() {
    if (this.audio) this.audio.volume = computeVolume();
  }

  applyLoop() {
    if (this.audio) this.audio.loop = !!getSetting("loop");
  }

  /** Show the playback UI on a row. Called again when the picker re-renders that row. */
  adoptRow(li) {
    if (this.row === li) return this.#renderRow();
    this.#releaseRow();
    this.row = li;
    li.classList.add("fpap-active");

    const progress = document.createElement("div");
    progress.className = "fpap-progress";
    progress.dataset.tooltip = localize("Seek");
    progress.addEventListener("click", this.#onSeek.bind(this));
    progress.addEventListener("dblclick", swallow);
    const bar = document.createElement("div");
    bar.className = "fpap-progress-bar";
    progress.append(bar);

    const time = document.createElement("span");
    time.className = "fpap-time";

    li.append(progress, time);
    this.#bar = bar;
    this.#time = time;
    this.#renderRow();
  }

  #releaseRow() {
    const li = this.row;
    this.row = null;
    this.#bar = null;
    this.#time = null;
    if (!li) return;
    li.classList.remove("fpap-active", "fpap-loading", "fpap-playing");
    for (const el of li.querySelectorAll(":scope > .fpap-progress, :scope > .fpap-time")) el.remove();
    const button = li.querySelector(":scope > .fpap-play");
    if (button) setButtonState(button, "idle");
  }

  #setState(state) {
    this.state = state;
    this.#renderRow();
  }

  #renderRow() {
    const li = this.row;
    if (!li) return;
    const playing = this.state === "playing";
    li.classList.toggle("fpap-loading", !playing);
    li.classList.toggle("fpap-playing", playing);
    const button = li.querySelector(":scope > .fpap-play");
    if (button) setButtonState(button, playing ? "playing" : "loading");
    this.#updateProgress();
  }

  #updateProgress() {
    const audio = this.audio;
    if (!audio || !this.row) return;
    const duration = audio.duration;
    const current = audio.currentTime || 0;
    const known = Number.isFinite(duration) && duration > 0;
    if (this.#bar) this.#bar.style.width = known ? `${clamp((current / duration) * 100, 0, 100)}%` : "0%";
    if (this.#time) {
      const text = known ? `${formatTime(current)} / ${formatTime(duration)}` : formatTime(current);
      if (this.#time.textContent !== text) this.#time.textContent = text;
    }
  }

  #onSeek(event) {
    swallow(event);
    const audio = this.audio;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0;
    audio.currentTime = ratio * audio.duration;
    this.#updateProgress();
  }

  #fail(audio, error) {
    if (this.audio !== audio) return;
    console.warn(`${MODULE_ID} | Could not play "${this.path}"`, error);
    ui.notifications?.warn(localize("PlaybackError", { name: this.name }));
    this.stop();
  }

  #startTicker() {
    this.#stopTicker();
    const tick = () => {
      this.#frame = null;
      if (!this.audio) return;
      const element = getAppElement(this.app);
      if (element && !element.isConnected) return this.stop(); // The picker window is gone.
      this.#updateProgress();
      this.#frame = requestAnimationFrame(tick);
    };
    this.#frame = requestAnimationFrame(tick);
  }

  #stopTicker() {
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
  }
}

const player = new PreviewPlayer();

/* -------------------------------------------- */
/*  FilePicker integration                      */
/* -------------------------------------------- */

/** Rows that already have their click listener. */
const boundRows = new WeakSet();

/** FilePicker app -> { element, observer } */
const observers = new WeakMap();

function decorateRow(li, app) {
  if (li.querySelector(":scope > .fpap-play")) return;
  const path = li.dataset.path;
  if (!path || !isAudioFile(path, app)) return;

  li.classList.add("fpap-audio");
  const button = document.createElement("button");
  button.type = "button"; // Never submit the picker's form.
  button.className = "fpap-play";
  button.draggable = false;
  setButtonState(button, UNPLAYABLE_EXTENSIONS.has(getExtension(path)) ? "unsupported" : "idle");
  button.addEventListener("click", (event) => {
    swallow(event); // Don't let Foundry treat this click as picking the file.
    player.toggle(li, app);
  });
  button.addEventListener("dblclick", swallow);
  li.prepend(button);

  if (!boundRows.has(li)) {
    boundRows.add(li);
    li.addEventListener("click", (event) => {
      if (!getSetting("playOnSelect")) return;
      if (event.target.closest?.(".fpap-play, .fpap-progress")) return;
      if (!player.isActive(li.dataset.path, app)) player.play(li, app);
    });
  }

  if (player.isActive(path, app)) player.adoptRow(li);
}

function decorate(root, app) {
  if (!root?.querySelectorAll) return;
  if (root.matches(ROW_SELECTOR)) decorateRow(root, app);
  for (const li of root.querySelectorAll(ROW_SELECTOR)) decorateRow(li, app);
}

function findRow(root, path) {
  for (const li of root.querySelectorAll(ROW_SELECTOR)) {
    if (li.dataset.path === path) return li;
  }
  return null;
}

/** Catch rows added after the render hook (lazy lists, other modules re-drawing rows). */
function watch(app, element) {
  const existing = observers.get(app);
  if (existing?.element === element) return;
  existing?.observer.disconnect();

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target;
      if (target.closest?.(".fpap-progress, .fpap-time")) continue; // Our own updates.
      const row = target.closest?.(ROW_SELECTOR);
      if (row) decorateRow(row, app);
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) decorate(node, app);
      }
    }
  });
  observer.observe(element, { childList: true, subtree: true });
  observers.set(app, { element, observer });
}

function onRenderFilePicker(app, html) {
  const element = getAppElement(app) ?? toElement(html);
  if (!element) return;
  decorate(element, app);
  watch(app, element);

  // If the file being previewed is no longer listed (you opened another folder), stop it.
  if (player.app === app && player.path && !findRow(element, player.path)) player.stop();
}

function onCloseFilePicker(app) {
  observers.get(app)?.observer.disconnect();
  observers.delete(app);
  player.stopIfOwnedBy(app);
}

/* -------------------------------------------- */
/*  Settings & hooks                            */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "volume", {
    name: "FPAP.Settings.Volume.Name",
    hint: "FPAP.Settings.Volume.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.5,
    onChange: () => player.applyVolume()
  });

  game.settings.register(MODULE_ID, "useInterfaceVolume", {
    name: "FPAP.Settings.UseInterfaceVolume.Name",
    hint: "FPAP.Settings.UseInterfaceVolume.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => player.applyVolume()
  });

  game.settings.register(MODULE_ID, "playOnSelect", {
    name: "FPAP.Settings.PlayOnSelect.Name",
    hint: "FPAP.Settings.PlayOnSelect.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "loop", {
    name: "FPAP.Settings.Loop.Name",
    hint: "FPAP.Settings.Loop.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => player.applyLoop()
  });
});

// "FilePicker" is in the class chain for core v12, core v13 and The Forge's subclasses.
Hooks.on("renderFilePicker", onRenderFilePicker);
Hooks.on("closeFilePicker", onCloseFilePicker);
Hooks.on("globalInterfaceVolumeChanged", () => player.applyVolume());
