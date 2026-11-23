import { MODULE_ID } from "./main.js";
import { EffectEditor } from "./effect-editor.js";
import { EFFECTS, SETTING_RANGES, getEffectParams, getEffectSettings } from "./effects.js";
import { getSheetDocument, resetSheetDocument } from "./compat.js";
import { refreshTileFx } from "./tile-fx.js";
import {
  PRESETS_CHANGED_HOOK, canEditPresets, deletePreset, findPreset, getPresetSlug, isDefaultPresetSlug, listPresets,
  savePreset
} from "./presets.js";

const TAB_ID = MODULE_ID;
const TEMPLATE = `modules/${MODULE_ID}/templates/tile-config-tab.hbs`;

const SHADER_CHOICES = {
  none: "TILE_FX_PAINTER.Config.Shader.Choices.None",
  ...Object.fromEntries(Object.entries(EFFECTS).map(([id, effect]) => [id, effect.label]))
};

// The open sections of each open sheet, as a Set of "<effectId>.<groupId>".
// Each render builds the tab again, thus a re-render needs this data to keep the sections open. The data goes when the sheet closes.
const openParamGroups = new WeakMap();

// The forms with the live preview listener. The sheet keeps its form across renders, and makes a new form after a close.
const previewForms = new WeakSet();

// The value setters of the pickers send their change events synchronously, thus this flag marks the events of a preset.
let applyingPreset = false;

/**
 * Get the template data of the param groups of each effect.
 * The tab has the groups of all effects, because the sheet does not render again when the dropdown changes.
 * @param {TileDocument} tileData
 * @param {string} activeEffect  The id of the selected effect.
 * @param {string} idPrefix
 * @param {Set<string>} openGroups  The open sections of the sheet.
 * @returns {object[]}
 */
function getEffectParamGroups(tileData, activeEffect, idPrefix, openGroups) {
  const savedPresets = tileData.flags[MODULE_ID]?.presets ?? {};
  return Object.entries(EFFECTS).map(([effectId, effect]) => {
    const values = getEffectParams(tileData, effectId);
    const keyPrefix = `TILE_FX_PAINTER.Params.${effectId.capitalize()}`;
    const groups = new Map();
    for (const [key, param] of Object.entries(effect.params)) {
      if (!groups.has(param.group)) groups.set(param.group, []);
      groups.get(param.group).push({
        id: `${idPrefix}-params-${effectId}-${key}`,
        name: `flags.${MODULE_ID}.params.${effectId}.${key}`,
        label: `${keyPrefix}.${key.capitalize()}.Label`,
        hint: `${keyPrefix}.${key.capitalize()}.Hint`,
        value: values[key],
        min: param.min,
        max: param.max,
        step: param.step,
        defaultValue: param.default
      });
    }
    return {
      effectId,
      presetId: `${idPrefix}-preset-${effectId}`,
      presetName: `flags.${MODULE_ID}.presets.${effectId}`,
      // fillPresetSelect ignores a slug that is not a preset now, for example a deleted preset.
      presetSlug: typeof savedPresets[effectId] === "string" ? savedPresets[effectId] : "",
      legend: game.i18n.format("TILE_FX_PAINTER.Config.Params.Legend", { effect: game.i18n.localize(effect.label) }),
      active: effectId === activeEffect,
      groups: Array.from(groups, ([groupId, fields]) => ({
        groupId,
        label: `TILE_FX_PAINTER.Config.Params.Groups.${groupId.capitalize()}`,
        open: openGroups.has(`${effectId}.${groupId}`),
        fields
      }))
    };
  });
}

/**
 * @param {HTMLSelectElement} select
 * @param {string} effectId
 * @param {string} [selected]  The slug of the preset to select.
 */
function fillPresetSelect(select, effectId, selected = "") {
  const presets = listPresets(effectId);
  const groups = [];
  for (const [builtIn, labelKey] of [[true, "Default"], [false, "World"]]) {
    const options = presets.filter((preset) => preset.builtIn === builtIn).map((preset) => new Option(preset.name, preset.slug));
    if (!options.length) continue;
    const group = document.createElement("optgroup");
    group.label = game.i18n.localize(`TILE_FX_PAINTER.Config.Presets.Groups.${labelKey}`);
    group.append(...options);
    groups.push(group);
  }
  select.replaceChildren(select.options[0], ...groups);
  select.value = presets.some((preset) => preset.slug === selected) ? selected : "";
  refreshPresetButtons(select);
}

/** The presets setting changed, on this client or on a different client. A deleted preset loses its selection. */
function refreshPresetSelects() {
  for (const select of document.querySelectorAll("[data-tile-fx-preset]")) {
    const effectId = select.closest("[data-tile-fx-params]")?.dataset.tileFxParams;
    if (effectId) fillPresetSelect(select, effectId, select.value);
  }
}

Hooks.on(PRESETS_CHANGED_HOOK, refreshPresetSelects);

/** A value set from code sends no change event, thus each value change calls this function. */
function refreshPresetButtons(select) {
  const isDefault = isDefaultPresetSlug(select.value);
  const saveButton = select.parentElement.querySelector(".tile-fx-painter-save-preset");
  if (saveButton) saveButton.disabled = isDefault;
  const deleteButton = select.parentElement.querySelector(".tile-fx-painter-delete-preset");
  if (deleteButton) deleteButton.disabled = !select.value || isDefault;
}

/**
 * Ask for a confirmation and delete the selected preset.
 * @param {HTMLFieldSetElement} fieldset
 * @param {HTMLSelectElement} select
 */
async function onDeletePreset(fieldset, select) {
  const effectId = fieldset.dataset.tileFxParams;
  const slug = select.value;
  if (!slug || isDefaultPresetSlug(slug)) return;
  const name = select.selectedOptions[0].text;
  const content = game.i18n.format("TILE_FX_PAINTER.Config.Presets.DeleteContent", {
    name: foundry.utils.escapeHTML(name)
  });
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "TILE_FX_PAINTER.Config.Presets.DeleteTitle" },
    content: `<p>${content}</p>`
  });
  if (!confirmed) return;

  try {
    await deletePreset(effectId, slug);
    ui.notifications.info("TILE_FX_PAINTER.Config.Presets.Deleted", { localize: true, format: { name } });
  } catch(err) {
    console.error(err);
    ui.notifications.error("TILE_FX_PAINTER.Config.Presets.DeleteFailed", { localize: true });
  }
}

function getSharedInput(tab, key) {
  return tab.querySelector(`[name="flags.${MODULE_ID}.${key}"]`);
}

/** The color picker reads its placeholder attribute only when it connects, thus also set the placeholder of its text input. */
function setColorPlaceholder(tab, effectId) {
  const picker = getSharedInput(tab, "color");
  const color = EFFECTS[effectId]?.defaultColor ?? "";
  picker.setAttribute("placeholder", color);
  const text = picker.querySelector('input[type="text"]');
  if (text) text.placeholder = color;
}

/**
 * The value setters send a change event that bubbles, the same as the reset button. Thus the live preview and the v14 preview document get the values.
 * @param {HTMLElement} tab
 * @param {HTMLFieldSetElement} fieldset  The params of the preset effect.
 * @param {object} preset
 */
function applyPreset(tab, fieldset, preset) {
  applyingPreset = true;
  try {
    for (const key of ["intensity", "speed", "scale"]) getSharedInput(tab, key).value = preset[key];
    getSharedInput(tab, "color").value = preset.color ?? "";
    for (const picker of fieldset.querySelectorAll("range-picker")) {
      const key = picker.name.split(".").pop();
      if (Object.hasOwn(preset.params, key)) picker.value = preset.params[key];
    }
  } finally {
    applyingPreset = false;
  }
}

/**
 * A user change to a value makes the values different from the selected preset, thus clear the selection.
 * The tab gets the event before the form, thus the v14 preview gets the cleared selection.
 * @param {HTMLElement} tab
 * @param {Event} event
 */
function onValueChange(tab, event) {
  if (applyingPreset || !event.target.matches("range-picker, color-picker")) return;
  // The shared inputs are not in an effect fieldset. They change the values of the selected effect.
  const fieldset = event.target.closest("[data-tile-fx-params]") ?? tab.querySelector("[data-tile-fx-params]:not([disabled])");
  if (fieldset) clearPresetSelection(fieldset);
}

function clearPresetSelection(fieldset) {
  const select = fieldset.querySelector("[data-tile-fx-preset]");
  if (!select?.value) return;
  select.value = "";
  refreshPresetButtons(select);
}

/**
 * Set the shared settings and the params of an effect to the defaults, and clear its preset selection.
 * @param {HTMLElement} tab
 * @param {HTMLFieldSetElement} fieldset
 */
function resetEffectValues(tab, fieldset) {
  // First, because the select sends no change event. The change events of the pickers send it to the v14 preview.
  clearPresetSelection(fieldset);
  // The value setter sends a change event that bubbles, thus the v14 preview also gets the defaults.
  for (const key of ["intensity", "speed", "scale"]) getSharedInput(tab, key).value = SETTING_RANGES[key].default;
  // An empty color is the default color of the effect.
  getSharedInput(tab, "color").value = "";
  for (const picker of fieldset.querySelectorAll("range-picker")) picker.value = picker.dataset.default;
}

/** The form values, not the document values, thus the preset has the unsubmitted changes. */
function readPresetSettings(tab, fieldset) {
  const params = {};
  for (const picker of fieldset.querySelectorAll("range-picker")) params[picker.name.split(".").pop()] = picker.value;
  return {
    intensity: getSharedInput(tab, "intensity").value,
    color: getSharedInput(tab, "color").value || null,
    speed: getSharedInput(tab, "speed").value,
    scale: getSharedInput(tab, "scale").value,
    params
  };
}

/**
 * Ask for a name and save the current values as a preset of the effect.
 * @param {HTMLElement} tab
 * @param {HTMLFieldSetElement} fieldset
 * @param {HTMLSelectElement} select
 */
async function onSavePreset(tab, fieldset, select) {
  const { DialogV2 } = foundry.applications.api;
  const effectId = fieldset.dataset.tileFxParams;
  // The selected preset is the default name, thus a change to a preset needs no new typing.
  const input = foundry.applications.fields.createTextInput({
    name: "name", value: select.selectedOptions[0]?.value ? select.selectedOptions[0].text : ""
  });
  input.autofocus = true;
  const group = foundry.applications.fields.createFormGroup({
    label: "TILE_FX_PAINTER.Config.Presets.NameLabel", input, localize: true
  });
  const result = await DialogV2.input({
    window: { title: "TILE_FX_PAINTER.Config.Presets.SaveTitle" },
    content: group.outerHTML,
    ok: { label: "TILE_FX_PAINTER.Config.Presets.Save", icon: "fa-solid fa-floppy-disk" }
  });
  const name = String(result?.name ?? "").trim();
  if (!name) return;
  if (!getPresetSlug(name)) {
    ui.notifications.warn("TILE_FX_PAINTER.Config.Presets.InvalidName", { localize: true });
    return;
  }

  const existing = findPreset(effectId, name);
  if (existing) {
    const content = game.i18n.format("TILE_FX_PAINTER.Config.Presets.ReplaceContent", {
      name: foundry.utils.escapeHTML(existing.name)
    });
    const replace = await DialogV2.confirm({
      window: { title: "TILE_FX_PAINTER.Config.Presets.ReplaceTitle" },
      content: `<p>${content}</p>`
    });
    if (!replace) return;
  }

  try {
    const preset = await savePreset(effectId, name, readPresetSettings(tab, fieldset));
    ui.notifications.info("TILE_FX_PAINTER.Config.Presets.Saved", { localize: true, format: { name: preset.name } });
    // The setting hook already filled the list. It keeps the old selection, thus select the new preset here.
    fillPresetSelect(select, effectId, preset.slug);
  } catch(err) {
    console.error(err);
    ui.notifications.error("TILE_FX_PAINTER.Config.Presets.SaveFailed", { localize: true });
  }
}

/**
 * Fill the preset select of an effect and add its listeners.
 * @param {HTMLElement} tab
 * @param {HTMLFieldSetElement} fieldset
 */
function activatePresets(tab, fieldset) {
  const select = fieldset.querySelector("[data-tile-fx-preset]");
  if (!select) return;
  const effectId = fieldset.dataset.tileFxParams;
  fillPresetSelect(select, effectId, select.dataset.selected);

  select.addEventListener("change", () => {
    refreshPresetButtons(select);
    const slug = select.value;
    if (!slug) return;
    const preset = listPresets(effectId).find((p) => p.slug === slug);
    if (preset) applyPreset(tab, fieldset, preset);
  });

  fieldset.querySelector(".tile-fx-painter-save-preset")?.addEventListener("click", () => {
    onSavePreset(tab, fieldset, select);
  });
  fieldset.querySelector(".tile-fx-painter-delete-preset")?.addEventListener("click", () => {
    onDeletePreset(fieldset, select);
  });
}

/**
 * Add the Tile FX Painter tab to the TileConfig sheet.
 * TileConfig does not have this tab in its static TABS, so the hook adds the navigation item and the tab content after each render.
 * The inputs use "flags.<MODULE_ID>.*" names, thus the sheet form saves them with the other tile data.
 */
Hooks.on("renderTileConfig", async (app, element) => {
  const nav = element.querySelector("nav.sheet-tabs");
  const group = nav?.querySelector("[data-group]")?.dataset.group;
  if (!group) return;

  // The core form listener is added first, thus this listener reads the new values from the live document.
  if (!previewForms.has(app.form)) {
    previewForms.add(app.form);
    app.form.addEventListener("change", () => refreshTileFx(app.document));
  }

  const idPrefix = `${app.id}-${MODULE_ID}`;
  // Show the values that the user did not submit. A re-render keeps them, the same as the core fields.
  const tileData = getSheetDocument(app);
  const flags = tileData.flags[MODULE_ID] ?? {};
  const settings = getEffectSettings(tileData);
  const openGroups = openParamGroups.get(app) ?? new Set();
  openParamGroups.set(app, openGroups);
  const html = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    moduleId: MODULE_ID,
    tabId: TAB_ID,
    group,
    inputId: `${idPrefix}-enabled`,
    enabled: settings.enabled,
    shaderId: `${idPrefix}-shader`,
    shaderChoices: SHADER_CHOICES,
    shader: settings.effect,
    intensityId: `${idPrefix}-intensity`,
    intensity: settings.intensity,
    // Show the saved value, not the default. An empty field keeps the default color, also after an effect change.
    colorId: `${idPrefix}-color`,
    color: flags.color ?? "",
    // Not settings.color: it is the saved color, thus an empty field shows the saved color.
    colorPlaceholder: EFFECTS[settings.effect]?.defaultColor ?? "",
    speedId: `${idPrefix}-speed`,
    speed: settings.speed,
    scaleId: `${idPrefix}-scale`,
    scale: settings.scale,
    ranges: SETTING_RANGES,
    effectParams: getEffectParamGroups(tileData, settings.effect, idPrefix, openGroups),
    canEditPresets: canEditPresets(),
    // The editor saves the mask in the tile flags, thus it needs no upload permission.
    canOpenEditor: app.document.canUserModify(game.user, "update"),
    // "Create Tile" closes the sheet, thus the button stays disabled until the user opens the sheet of the created tile.
    tileCreated: EffectEditor.isCreated(app.document)
  });

  // A re-render keeps the elements that are not application parts. Remove the old tab after the await, so that two quick renders do not add two tabs.
  element.querySelectorAll(`[data-group="${group}"][data-tab="${TAB_ID}"]`).forEach((el) => el.remove());

  // The core parts do not know this tab. Set the "active" class here, so that the tab stays open after a re-render.
  const active = app.tabGroups[group] === TAB_ID;

  const navItem = document.createElement("a");
  navItem.dataset.action = "tab";
  navItem.dataset.group = group;
  navItem.dataset.tab = TAB_ID;
  navItem.classList.toggle("active", active);
  navItem.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles" inert></i><span></span>`;
  navItem.querySelector("span").textContent = game.i18n.localize("TILE_FX_PAINTER.Tab.Label");
  nav.append(navItem);

  const template = document.createElement("template");
  template.innerHTML = html.trim();
  const tab = template.content.firstElementChild;
  tab.classList.toggle("active", active);

  // Each render makes a new tab element, thus the listeners must be added again.
  tab.querySelector(".tile-fx-painter-open-editor")?.addEventListener("click", () => EffectEditor.open(app.document));
  tab.addEventListener("change", (event) => onValueChange(tab, event));

  // The form data skips a disabled fieldset, thus the sheet saves only the params of the selected effect.
  // This listener runs before the listener on the form, thus the v14 preview gets the params of the new effect.
  const paramGroups = tab.querySelectorAll("[data-tile-fx-params]");
  tab.querySelector(`[name="flags.${MODULE_ID}.shader"]`).addEventListener("change", (event) => {
    // Before the reset, because the color setter shows the placeholder color for an empty value.
    setColorPlaceholder(tab, event.currentTarget.value);
    for (const fieldset of paramGroups) {
      const selected = fieldset.dataset.tileFxParams === event.currentTarget.value;
      fieldset.hidden = !selected;
      fieldset.disabled = !selected;
      // The values of the old effect stay in the shared inputs, thus no preset selection is correct after a change.
      clearPresetSelection(fieldset);
      if (selected) resetEffectValues(tab, fieldset);
    }
    app.setPosition({ height: "auto" });
  });

  for (const fieldset of paramGroups) {
    fieldset.querySelector(".tile-fx-painter-reset-params").addEventListener("click", () => {
      resetEffectValues(tab, fieldset);
    });

    // The toggle event does not bubble, thus each section needs its own listener.
    for (const section of fieldset.querySelectorAll("details[data-param-group]")) {
      section.addEventListener("toggle", () => {
        const key = `${fieldset.dataset.tileFxParams}.${section.dataset.paramGroup}`;
        if (section.open) openGroups.add(key);
        else openGroups.delete(key);
        app.setPosition({ height: "auto" });
      });
    }
  }

  const tabs = element.querySelectorAll(`.tab[data-group="${group}"]`);
  tabs[tabs.length - 1].after(tab);

  for (const fieldset of paramGroups) activatePresets(tab, fieldset);

  app.setPosition({ height: "auto" });
});

Hooks.on("closeTileConfig", (app) => {
  resetSheetDocument(app);
  // The sheet is not in document.apps now, thus the sync shows the saved values.
  refreshTileFx(app.document);
  // Foundry keeps the sheet of a tile and uses it again. Without this delete, the sheet opens with the old sections open.
  openParamGroups.delete(app);
});
