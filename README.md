# Tile FX Painter

Tile FX Painter is a module for Foundry VTT. It adds animated shader effects to tiles. You paint a mask on a tile, and the effect shows only in the painted area.

The module was made for Foundry VTT. It supports V13 and V14.

## Before and After

### Before

The demo map with no effects.

![The demo map with no effects](docs/No%20Shader%20Demo.png)

### After

The same map with the effects.

![The demo map with the effects](docs/Shader%20Demo.gif)

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

## Mask Editor

The Mask Editor shows the area of the background image under the tile.

The editor has these tools:

- Brush, with size, hardness, and opacity
- Eraser
- Color select
- Rectangle
- Ellipse
- Polygon

The editor can also invert the mask, clear the mask, undo a change, and redo a change.

The module saves each mask as a PNG file in the User Data location. The default directory is `modules/tile-fx-painter/storage/masks`. You can change the directory in the world setting of the module.

## Limits

- Only users with the `FILES_UPLOAD` permission can open the Mask Editor.
- You must create a tile before you can open the Mask Editor for it.
- The effects use only the background image under the tile. They do not use other tiles or tokens.
- Video backgrounds are not supported.
- While you drag a tile, the effect stays at the old position.

## Installation

1. Put the module directory in the Foundry `Data/modules/` directory. The directory name must be `tile-fx-painter`.
2. Start Foundry VTT.
3. Enable the module in a world.

Or it can be downloaded from Foundry directly.



## AI Disclaimer

This module was coded the help of AI for the following:

- To write the code comments.
- To assist with the shader code.
- To understand the Foundry API and how to attach code to its hooks.

## License

The module has the MIT License. Refer to [LICENSE](LICENSE).
