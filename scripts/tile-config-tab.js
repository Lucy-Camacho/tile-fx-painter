import { MODULE_ID } from "./main.js";

const TAB_ID = MODULE_ID;
const TEMPLATE = `modules/${MODULE_ID}/templates/tile-config-tab.hbs`;

/**
 * Add the Tile FX Painter tab to the TileConfig sheet.
 * TileConfig does not have this tab in its static TABS, so the hook adds the navigation item and the tab content after each render.
 * The inputs use "flags.<MODULE_ID>.*" names, thus the sheet form saves them with the other tile data.
 */
Hooks.on("renderTileConfig", async (app, element) => {
  const nav = element.querySelector("nav.sheet-tabs");
  const group = nav?.querySelector("[data-group]")?.dataset.group;
  if (!group) return;

  const html = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    moduleId: MODULE_ID,
    tabId: TAB_ID,
    group,
    inputId: `${app.id}-${MODULE_ID}-enabled`,
    enabled: app.document.getFlag(MODULE_ID, "enabled") ?? false
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

  const tabs = element.querySelectorAll(`.tab[data-group="${group}"]`);
  tabs[tabs.length - 1].after(tab);

  app.setPosition({ height: "auto" });
});
