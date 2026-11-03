import { TileFxShader } from "./tile-fx-shader.js";
import { getParamDefaults } from "../effects.js";

/**
 * The metallic effect. It changes the mask area to polished metal, tinted with the effect color.
 * The background brightness sets the tone of the metal, and a slow light and a shine band move over it.
 * The reflections also move with the camera of each client, as on a real metal surface.
 */
export class MetallicShader extends TileFxShader {
  static defaultUniforms = {
    ...super.defaultUniforms,
    viewTransform: [1, 1, 0, 0],
    ...getParamDefaults("metallic")
  };

  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.PERCEIVED_BRIGHTNESS}

    // Changes a position in the scene rectangle (from sceneMatrix) to the offset from the camera center.
    // The offset is 1 at the view radius: offset = scenePos * viewTransform.xy + viewTransform.zw.
    uniform vec4 viewTransform;

    // The params of the tile (EFFECTS.metallic.params).
    uniform float shininess;          // The specular exponent.
    uniform float shineBand;          // A multiplier on the light of the shine band.
    uniform float cameraMotion;       // A multiplier on VIEW_TILT and BAND_PARALLAX.
    uniform float shadowTone;         // The tone of the darkest map areas.

    // The tilt of the view direction at offset 1. A higher value moves the highlights more.
    const float VIEW_TILT = 0.6;
    // The shift of the shine band for a camera movement. 0 keeps the band on the metal.
    const float BAND_PARALLAX = 0.5;
    // The diffuse light on the flat metal.
    const float DIFFUSE = 0.9;

    vec4 _main() {
      float s = min(strength(), 1.0);
      if ( s <= 0.0 ) return vec4(0.0);

      // With no background, the metal is of medium brightness.
      vec4 base = sampleBase(vUvs);
      float luma = base.a > 0.0 ? perceivedBrightness(unpremultiply(base)) : 0.5;

      // The eye is above the camera center. Thus a pixel away from the center sees the metal at an angle.
      vec2 offset = ((sceneMatrix * vec3(vUvs, 1.0)).xy * viewTransform.xy) + viewTransform.zw;
      vec3 view = normalize(vec3(-offset * VIEW_TILT * cameraMotion, 1.0));

      // A light that turns slowly around the area. The metal is flat, thus its normal is (0, 0, 1).
      float angle = phase * 0.5;
      vec3 light = normalize(vec3(cos(angle), sin(angle), 1.2));
      vec3 mirrored = vec3(-light.xy, light.z);
      float specular = pow(max(dot(mirrored, view), 0.0), shininess);

      // A soft diagonal shine band. At pattern scale 1, the distance between two bands is about 2 grid squares (about 2.9 along one axis).
      // It moves with the time and with the camera.
      // A cosine wave has no seam between two bands, also when the band is wide.
      vec2 pos = patternPos();
      float bandPos = ((pos.x + pos.y) * 0.35) - (phase * 0.2) + ((offset.x + offset.y) * BAND_PARALLAX * cameraMotion);
      float wave = 0.5 + (0.5 * cos(bandPos * TWOPI));
      // The core is the bright center of the band. The glow is the wide light around it.
      float core = pow(wave, 4.0);
      float glow = wave * wave;

      // More contrast than the map, but a dark area does not become black.
      float tone = shadowTone + ((1.0 - shadowTone) * smoothstep(0.1, 0.9, luma));
      // The metal reflects the glow of the band in its own color.
      vec3 metal = effectColor * tone * DIFFUSE * (1.0 + (glow * 0.6 * shineBand));
      // The highlights mix white and the tint, as on real metal. The highlight is brighter in the band.
      metal += mix(vec3(1.0), effectColor, 0.3) * specular * (0.6 + (core * 0.8 * shineBand));
      metal += mix(vec3(1.0), effectColor, 0.5) * core * 0.3 * shineBand;
      // The color must not be more than the alpha (s), because the output is premultiplied. Alpha s is at most 1.
      metal = min(metal, vec3(1.0));
      // tintAlpha.a is the mesh alpha, for example 0.5 for a hidden tile.
      return vec4(metal * s, s) * tintAlpha.a;
    }
  `;
  }

  /** @override */
  _preRender(mesh, renderer) {
    super._preRender(mesh, renderer);
    // The view radius is half of the longer screen side, in scene pixels. One radius for both axes prevents a stretched offset.
    const { sceneX, sceneY, sceneWidth, sceneHeight } = canvas.dimensions;
    const [screenWidth, screenHeight] = canvas.screenDimensions;
    const { pivot, scale } = canvas.stage;
    const radius = Math.max((0.5 * Math.max(screenWidth, screenHeight)) / scale.x, 1);
    const view = this.uniforms.viewTransform;
    view[0] = sceneWidth / radius;
    view[1] = sceneHeight / radius;
    view[2] = (sceneX - pivot.x) / radius;
    view[3] = (sceneY - pivot.y) / radius;
  }
}
