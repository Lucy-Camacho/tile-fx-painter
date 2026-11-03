import { MODULE_ID } from "./main.js";
import { EffectEditor } from "./effect-editor.js";
import { EFFECTS, getEffectParams, getEffectSettings } from "./effects.js";
import { getSheetDocument, resetSheetDocument } from "./compat.js";

const TAB_ID = MODULE_ID;
const TEMPLATE = `modules/${MODULE_ID}/templates/tile-config-tab.hbs`;

const SHADER_CHOICES = {
  none: "TILE_FX_PAINTER.Config.Shader.Choices.None",
  ...Object.fromEntries(Object.entries(EFFECTS).map(([id, effect]) => [id, effect.label]))
};

/**
 * Get the template data of the param group of each effect.
 * The tab has the groups of all effects, because the sheet does not render again when the dropdown changes.
 * @param {TileDocument} tileData
 * @param {string} activeEffect  The id of the selected effect.
 * @param {string} idPrefix
 * @returns {object[]}
 */
function getEffectParamGroups(tileData, activeEffect, idPrefix) {
  return Object.entries(EFFECTS).map(([effectId, effect]) => {
    const values = getEffectParams(tileData, effectId);
    const keyPrefix = `TILE_FX_PAINTER.Params.${effectId.capitalize()}`;
    return {
      effectId,
      legend: game.i18n.format("TILE_FX_PAINTER.Config.Params.Legend", { effect: game.i18n.localize(effect.label) }),
      active: effectId === activeEffect,
      fields: Object.entries(effect.params).map(([key, param]) => ({
        id: `${idPrefix}-params-${effectId}-${key}`,
        name: `flags.${MODULE_ID}.params.${effectId}.${key}`,
        label: `${keyPrefix}.${key.capitalize()}.Label`,
        hint: `${keyPrefix}.${key.capitalize()}.Hint`,
        value: values[key],
        min: param.min,
        max: param.max,
        step: param.step,
        defaultValue: param.default
      }))
    };
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

  const idPrefix = `${app.id}-${MODULE_ID}`;
  // Show the values that the user did not submit. A re-render keeps them, the same as the core fields.
  const tileData = getSheetDocument(app);
  const flags = tileData.flags[MODULE_ID] ?? {};
  const settings = getEffectSettings(tileData);
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
    colorPlaceholder: settings.color ?? "",
    speedId: `${idPrefix}-speed`,
    speed: settings.speed,
    scaleId: `${idPrefix}-scale`,
    scale: settings.scale,
    effectParams: getEffectParamGroups(tileData, settings.effect, idPrefix),
    // The editor saves the mask as an uploaded file. Users who cannot upload cannot use it.
    canOpenEditor: game.user.can("FILES_UPLOAD"),
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

  // The form data skips a disabled fieldset, thus the sheet saves only the params of the selected effect.
  // This listener runs before the listener on the form, thus the v14 preview gets the params of the new effect.
  const paramGroups = tab.querySelectorAll("[data-tile-fx-params]");
  tab.querySelector(`[name="flags.${MODULE_ID}.shader"]`).addEventListener("change", (event) => {
    for (const fieldset of paramGroups) {
      const selected = fieldset.dataset.tileFxParams === event.currentTarget.value;
      fieldset.hidden = !selected;
      fieldset.disabled = !selected;
    }
    app.setPosition({ height: "auto" });
  });

  for (const fieldset of paramGroups) {
    fieldset.querySelector(".tile-fx-painter-reset-params").addEventListener("click", () => {
      // The value setter sends a change event that bubbles, thus the v14 preview also gets the defaults.
      for (const picker of fieldset.querySelectorAll("range-picker")) picker.value = picker.dataset.default;
    });
  }

  const tabs = element.querySelectorAll(`.tab[data-group="${group}"]`);
  tabs[tabs.length - 1].after(tab);

  app.setPosition({ height: "auto" });
});

Hooks.on("closeTileConfig", (app) => resetSheetDocument(app));
