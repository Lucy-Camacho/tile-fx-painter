# Tile FX Painter

Tile FX Painter is a module for Foundry VTT. It adds animated shader effects to tiles. You paint a mask on a tile, and the effect shows only in the painted area.

The module was made for Foundry VTT. It supports V13 and V14.

## Before and After

The demo map with no effects (left) and with the effects (right). The demo map was made with Dungeondraft.

<table>
  <tr>
    <th>Before</th>
    <th>After</th>
  </tr>
  <tr>
    <td width="50%"><img src="docs/no-shader-demo.png" alt="The demo map with no effects" width="400" height="400"></td>
    <td width="50%"><img src="docs/shader-demo.gif" alt="The demo map with the effects" width="400" height="400"></td>
  </tr>
</table>

## Effects

| Effect | Description |
| --- | --- |
| Glow | A light with a soft halo. The halo can go past the tile frame. |
| Metallic | Brushed metal. The reflections move with time and with the camera. |
| Liquid | A dark liquid with a rainbow film, small ripples, and wet highlights. |
| Lava | Solid crust on molten rock, with hot veins. A soft light can go past the tile frame. |
| Water | Clear water with surface waves, light patterns on the bottom, and foam at the shore. |
| Frost | A sheet of ice with cracks, sparkles, and fog along the mask border. |
| Astral Void | A hole into space, with stars and color clouds. It does not use the map color. |

## Tile Settings

The tile configuration window has an FX Painter tab. Use this tab to enable an effect on the tile and to change it.

<img src="docs/tile-config-fx-tab-lava.jpg" alt="The FX Painter tab with the Lava effect" width="400" height="500">

Expand a group to show its settings. The text below each setting explains what it does.

<img src="docs/lava-settings-expanded-1.jpg" alt="The Lava Settings section with the Molten Rock and Crust groups expanded" width="400" height="500">

## Mask Editor

The Mask Editor shows the area of the background image under the tile.

<img src="docs/mask-editor.jpg" alt="The Mask Editor with a painted mask on a tile" width="400" height="500">

The editor has these tools:

- Brush, with size, hardness, and opacity
- Eraser
- Color select
- Rectangle
- Ellipse
- Polygon

The editor can also invert the mask, clear the mask, undo a change, and redo a change.

The module saves each mask as a small grayscale PNG in the tile data. Thus a scene export or a compendium keeps the masks. The module continues to show the mask files of version 0.1.0. The next save of the tile embeds the mask.

## API

Macros and other modules can change the effect settings with `game.modules.get("tile-fx-painter").api`. The API does not change the mask. A tile with no mask shows no effect.

A `tiles` argument is one value or an array. A value is a tile document, a tile on the canvas, a tile id on the viewed scene, or a tile UUID.

| Function | Result |
| --- | --- |
| `getEffects()` | The effects, with the default value, the minimum, and the maximum of each param. |
| `getSettings(tile)` | The saved settings of the tile. |
| `update(tiles, changes)` | Changes `enabled`, `effect`, `intensity`, `color`, `speed`, `scale`, and `params`. A `null` color sets the default color. |
| `enable(tiles)`, `disable(tiles)`, `toggle(tiles)` | Turns the effect on or off. |
| `setEffect(tiles, effectId)` | Sets the effect. `"none"` removes the effect. |
| `setParams(tiles, params, { effect })` | Sets the params of the effect. The default effect is the effect of the tile. |
| `resetParams(tiles, { effect })` | Sets the params of the effect back to the defaults. |

Turn on lava on the selected tiles:

```js
const api = game.modules.get("tile-fx-painter").api;
await api.update(canvas.tiles.controlled, { enabled: true, effect: "lava", params: { heatLevel: 1.5 } });
```

Refer to the [API documentation](docs/API.md) for all functions, the params of each effect, and more examples.

## Performance

The module was tested with more than 70 tiles, all with shader effects. The test showed no noticeable performance decrease.

## Limits

- Only users with the permission to update the tile can open the Mask Editor.
- You must create a tile before you can open the Mask Editor for it.
- Video backgrounds are not supported.
- While you drag a tile, the effect stays at the old position.

## Installation

1. Put the module directory in the Foundry `Data/modules/` directory. The directory name must be `tile-fx-painter`.
2. Start Foundry VTT.
3. Enable the module in a world.

Or it can be downloaded from Foundry directly.



## AI Disclaimer

This module was coded the help of AI for the following:

- Write the code comments.
- Assist with the shader code.
- Understand the Foundry API and how to attach code to its hooks.

## License

The module has the MIT License. Refer to [LICENSE](LICENSE).
