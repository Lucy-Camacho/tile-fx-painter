# Tile FX Painter API

Macros and other modules can control the tile effects with the API. The API changes the effect settings of a tile. It does not change the mask.

## Contents

- [Get the API](#get-the-api)
- [Before you start](#before-you-start)
- [The tiles argument](#the-tiles-argument)
- [Return values and errors](#return-values-and-errors)
- [Functions](#functions)
- [Effects and params](#effects-and-params)
- [Examples](#examples)

## Get the API

```js
const api = game.modules.get("tile-fx-painter").api;
```

The module adds the API in the `init` hook. In a module, use the API in the `setup` hook or later. A macro can always use it.

## Before you start

- A tile shows an effect only when all of these conditions are true:
  - The effect is enabled.
  - The tile has an effect that is not `"none"`.
  - The tile has a mask.
- The API cannot make a mask. Paint the mask in the Mask Editor first.
- The user must have the permission to update the tile.
- Use the API to change the settings. Do not write the `tile-fx-painter` flags directly. The API makes sure that each value is correct.

## The tiles argument

The write functions accept one tile or an array of tiles. A tile can be one of these values:

| Value | Example |
| --- | --- |
| A tile document | `canvas.scene.tiles.contents[0]` |
| A tile on the canvas | `canvas.tiles.controlled[0]` |
| A tile id on the viewed scene | `"def456"` |
| A tile UUID | `"Scene.abc123.Tile.def456"` |

The tiles can be on different scenes. The API sends one update for each scene.

## Return values and errors

- Each write function returns a `Promise` of the updated `TileDocument[]`. Use `await`.
- The API clamps each number to its range. For example, a `scale` of 10 becomes 4.
- The API checks all tiles and all values before it writes. A bad value causes an `Error`, and no tile changes. These are bad values:
  - A tile that the API cannot find.
  - A tile that the user cannot update.
  - An unknown effect id or param key.
  - A value of the wrong type, for example a string for a number.
- If Foundry refuses the update of one scene, the tiles on the other scenes can still change.

## Functions

### `getEffects()`

Returns a copy of all effects. The key is the effect id.

```js
{
  lava: {
    label: "TILE_FX_PAINTER.Config.Shader.Choices.Lava",
    defaultColor: "#e8400a",
    params: {
      heatLevel: { default: 1, min: 0, max: 2, step: 0.05, group: "moltenRock" },
      // ...
    }
  },
  // ...
}
```

The `label` is a translation key. Use `game.i18n.localize(label)` to get the text.

### `getSettings(tile)`

Returns the saved settings of one tile. The values have the defaults and the clamps applied.

```js
{
  enabled: true,
  effect: "lava",       // "none" if the tile has no effect
  intensity: 1,
  color: "#e8400a",     // null if the effect is "none"
  speed: 1,
  scale: 1,
  hasMask: true,
  params: { moltenAmount: 0.6, heatLevel: 1, ... }   // the params of the current effect
}
```

This function does not need the update permission.

### `update(tiles, changes)`

Changes one or more settings. Give only the keys that you want to change.

| Key | Type | Range | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | | Turns the effect on or off. |
| `effect` | `string` | An effect id or `"none"` | The effect of the tile. |
| `intensity` | `number` | 0 to 2 | The strength of the effect. |
| `color` | `string` or `null` | `"#rrggbb"` | The color of the effect. `null` or `""` sets the default color of the effect. |
| `speed` | `number` | 0 to 3 | The speed of the animation. 0 stops the animation. |
| `scale` | `number` | 0.25 to 4 | The size of the pattern. At 1, one pattern unit is one grid square. |
| `params` | `object` | Refer to [Effects and params](#effects-and-params) | The params of the effect. |

The `params` apply to the effect in `changes.effect`. If `changes.effect` is not given, they apply to the saved effect of the tile.

```js
await api.update(tile, { enabled: true, effect: "water", color: "#2a8f6a", params: { flowAmount: 0.3 } });
```

### `enable(tiles)` and `disable(tiles)`

Turn the effect on or off.

```js
await api.enable(tile);
```

### `toggle(tiles)`

Each tile gets the opposite of its own state. Thus, in an array, some tiles can turn on while other tiles turn off.

```js
await api.toggle(canvas.tiles.controlled);
```

### `setEffect(tiles, effectId)`

Sets the effect. `"none"` removes the effect. The params of the old effect stay in the tile, thus they come back if you select that effect again.

```js
await api.setEffect(tile, "frost");
```

### `setParams(tiles, params, { effect })`

Sets the params of an effect. This function does not change the effect of the tile.

- Without `effect`, the params apply to the saved effect of each tile. A tile with the effect `"none"` causes an error.
- With `effect`, the params apply to that effect. Use this to prepare the params before you select the effect.

```js
await api.setParams(tile, { heatRadius: 1, flowAngle: 90 });
await api.setParams(tile, { foamAmount: 0.8 }, { effect: "water" });
```

### `resetParams(tiles, { effect })`

Sets all params of an effect back to the defaults. The `effect` option works the same as in `setParams`.

```js
await api.resetParams(tile);
```

## Effects and params

Distances use pattern units. One pattern unit is one grid square at a `scale` of 1. Use `getEffects()` to get these values in a script.

### Glow (`glow`)

Default color: `#ffb04a`.

| Param | Default | Min | Max | Description |
| --- | --- | --- | --- | --- |
| `haloRadius` | 0.5 | 0.1 | 2 | The size of the light around the painted area, in pattern units. |
| `haloLight` | 0.9 | 0 | 2 | The brightness of the light around the painted area. |
| `coreWhite` | 0.35 | 0 | 1 | The quantity of white in the painted area. A higher value gives a hotter center. |
| `flickerAmount` | 1 | 0 | 3 | The strength of the changes in the light. 0 gives a steady glow. |

### Metallic (`metallic`)

Default color: `#c9d1d9`.

| Param | Default | Min | Max | Description |
| --- | --- | --- | --- | --- |
| `smoothness` | 0.5 | 0 | 1 | 0 gives rough metal with wide and dim reflections. 1 gives polished metal with narrow and bright reflections. |
| `grainAmount` | 0.5 | 0 | 2 | The depth of the brush lines. 0 removes the lines. |
| `shadowTone` | 0.1 | 0 | 1 | The brightness of the metal on the darkest map areas. 1 gives a flat metal. |
| `shineBand` | 1 | 0 | 2 | The brightness of the moving bands of light. 0 removes the bands. |
| `cameraMotion` | 1 | 0 | 2 | The movement of the reflections when the camera moves. 0 keeps them still. |

### Liquid (`liquid`)

Default color: `#1c2230`. The color is the dark color of the liquid, under the rainbow colors.

| Param | Default | Min | Max | Description |
| --- | --- | --- | --- | --- |
| `warpAmount` | 4 | 0 | 8 | The twist of the swirls. 0 gives soft clouds with no swirls. |
| `bands` | 2 | 0.5 | 5 | The number of rainbow cycles in the film. |
| `filmAmount` | 0.35 | 0 | 1 | The quantity of rainbow color. 0 removes the rainbow. |
| `darken` | 0.45 | 0 | 1 | The quantity of map brightness that stays in the liquid. |
| `ripple` | 0.06 | 0 | 0.2 | The height of the small ripples. |
| `refractAmount` | 0.05 | 0 | 0.2 | The maximum shift of the map under the liquid, in pattern units. |
| `specularAmount` | 0.7 | 0 | 1.5 | The brightness of the wet highlights. |

### Lava (`lava`)

Default color: `#e8400a`.

| Param | Default | Min | Max | Description |
| --- | --- | --- | --- | --- |
| `moltenAmount` | 0.6 | 0 | 1 | The part of the surface that is molten. A low value gives mostly crust. |
| `heatLevel` | 1 | 0 | 2 | The heat of the molten color. A higher value gives more yellow and white. |
| `warpAmount` | 1 | 0 | 1.5 | The bend of the hot veins. The crust does not bend. |
| `heatRadius` | 0.4 | 0 | 2 | The size of the light around the painted area, in pattern units. 0 removes the light. |
| `crustBrightness` | 0.1 | 0 | 1 | The quantity of map brightness in the crust. 0 gives a black crust. |
| `detailAmount` | 1 | 0 | 2 | The roughness of the crust edges and the quantity of small veins. |
| `reliefAmount` | 1 | 0 | 2 | The height of the rough crust surface. 0 gives a flat crust. |
| `pulseAmount` | 0.5 | 0 | 1 | The change of the molten heat with time. 0 removes the pulse. |
| `flowAngle` | 0 | 0 | 360 | The flow direction in degrees. The direction turns with the tile. |
| `flowAmount` | 0.05 | 0 | 1 | The flow speed. The crust moves at half of this speed. |

### Water (`water`)

Default color: `#1f6f8b`. The color is the color of the deep water.

| Param | Default | Min | Max | Description |
| --- | --- | --- | --- | --- |
| `depthTint` | 0.55 | 0 | 1 | The quantity of effect color at the center of the water. 0 gives clear water. |
| `shoreWidth` | 0.75 | 0.1 | 3 | The distance from the edge of the painted area to the deep water, in pattern units. |
| `foamAmount` | 0.4 | 0 | 1 | The brightness of the foam at the edge. 0 removes the foam. |
| `waveHeight` | 0.5 | 0 | 2 | The height of the surface waves. 0 gives a flat surface. |
| `refractAmount` | 0.04 | 0 | 0.2 | The maximum shift of the map under the water, in pattern units. |
| `causticAmount` | 0.6 | 0 | 2 | The brightness of the light patterns on the bottom. |
| `specularAmount` | 0.6 | 0 | 1.5 | The brightness of the sun highlights on the waves. |
| `flowAngle` | 0 | 0 | 360 | The flow direction in degrees. The direction turns with the tile. |
| `flowAmount` | 0 | 0 | 1 | The flow speed. 0 gives a still pool. |

### Frost (`frost`)

Default color: `#2f7fb5`. The color is the middle tone of the ice.

| Param | Default | Min | Max | Description |
| --- | --- | --- | --- | --- |
| `frostCover` | 1 | 0 | 1 | The quantity of ice at full mask alpha. A very low value shows only thin cracks. |
| `edgeRoughness` | 0.15 | 0 | 0.5 | The shift of the edge of the painted area, in pattern units. 0 keeps the painted edge. |
| `edgeFade` | 0.3 | 0 | 1 | The width of the fade from the ice to the map at a hard edge, in pattern units. |
| `frostTint` | 0.5 | 0 | 1 | The quantity of effect color in the ice. 0 gives clear ice. |
| `frostBlur` | 0.03 | 0 | 0.15 | The blur radius of the map below the ice, in pattern units. |
| `ridgeAmount` | 0.8 | 0 | 1.5 | The brightness of the cracks and scratches. |
| `sparkleAmount` | 0.6 | 0 | 2 | The brightness of the sparkles. 0 removes them. |
| `shineAmount` | 0.25 | 0 | 1 | The brightness of the soft reflections. 0 removes them. |
| `fogRadius` | 0.4 | 0 | 2 | The distance of the fog from the border of the painted area, in pattern units. |
| `fogAmount` | 0.4 | 0 | 1 | The density of the fog. 0 removes the fog. |
| `currentAmount` | 0.6 | 0 | 1.5 | The strength of the water that moves below the ice. 0 removes it. |
| `floeAmount` | 0.6 | 0 | 1.5 | The strength of the pieces of ice below the surface. 0 removes them. |

### Astral Void (`astralVoid`)

Default color: `#5b2be0`. The color is the color of the clouds and of the light at the edge.

| Param | Default | Min | Max | Description |
| --- | --- | --- | --- | --- |
| `starDensity` | 0.5 | 0 | 1 | The quantity of stars. 0 removes them. |
| `starBrightness` | 1 | 0 | 2 | The brightness of the stars. |
| `twinkleAmount` | 0.5 | 0 | 1 | The change of the star brightness with time. 0 gives steady stars. |
| `depthAmount` | 0.5 | 0 | 2 | The movement of the stars when the camera moves. 0 keeps the stars on the map. |
| `nebulaAmount` | 0.7 | 0 | 1.5 | The brightness of the color clouds. 0 removes them. |
| `rimRadius` | 0.25 | 0 | 1 | The size of the light around the painted area, in pattern units. 0 removes it. |
| `rimLight` | 1 | 0 | 2 | The brightness of the light around the painted area. |

## Examples

### Turn on lava on the selected tiles

```js
const api = game.modules.get("tile-fx-painter").api;
await api.update(canvas.tiles.controlled, { enabled: true, effect: "lava", params: { heatLevel: 1.5 } });
```

### Turn the effect of one tile on or off

```js
await game.modules.get("tile-fx-painter").api.toggle("Scene.abc123.Tile.def456");
```

### Freeze a pool of water

```js
const api = game.modules.get("tile-fx-painter").api;
const tile = canvas.tiles.controlled[0];
await api.update(tile, { effect: "frost", color: null, params: { frostCover: 0.8 } });
```

### Find all tiles with an effect on the viewed scene

```js
const api = game.modules.get("tile-fx-painter").api;
const tiles = canvas.scene.tiles.filter((tile) => {
  const settings = api.getSettings(tile);
  return settings.enabled && settings.hasMask && (settings.effect !== "none");
});
```

### Use the API from a module

```js
Hooks.once("ready", () => {
  const api = game.modules.get("tile-fx-painter")?.api;
  if (!api) return;
  // Use the API here.
});
```
