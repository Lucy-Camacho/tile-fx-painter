import { TileFxShader } from "./tile-fx-shader.js";

/**
 * The metallic effect. It changes the mask area to polished metal, tinted with the effect color.
 * The shapes in the background image become small bumps in the metal, and a slow light moves over them.
 * The reflections also move with the camera of each client, as on a real metal surface.
 */
export class MetallicShader extends TileFxShader {
  static defaultUniforms = {
    ...super.defaultUniforms,
    viewTransform: [1, 1, 0, 0]
  };

  /** @override */
  static get _effectShader() {
    return `
    ${this.CONSTANTS}
    ${this.PERCEIVED_BRIGHTNESS}

    // Changes a position in the scene rectangle (from baseMatrix) to the offset from the camera center.
    // The offset is 1 at the edge of the view: offset = scenePos * viewTransform.xy + viewTransform.zw.
    uniform vec4 viewTransform;

    // The height of the bumps. A higher value gives a deeper relief.
    const float BUMP = 3.0;
    // The distance of the relief samples, in background texture pixels.
    const float RELIEF_STEP = 1.5;
    // The tilt of the view direction at the edge of the view. A higher value moves the highlights more.
    const float VIEW_TILT = 0.6;
    // The movement of the shine band for a camera movement. 0 keeps the band on the metal.
    const float BAND_PARALLAX = 0.5;

    // The brightness of the background at a texture UV. The color is premultiplied, thus divide by the alpha.
    float baseLuma(vec2 uv) {
      vec4 color = texture(baseSampler, uv);
      return color.a > 0.0 ? perceivedBrightness(color.rgb / color.a) : 0.5;
    }

    vec4 _main() {
      float s = min(strength(), 1.0);
      if ( s <= 0.0 ) return vec4(0.0);

      // With no background, the metal is flat and of medium brightness.
      // The normal is in background texture axes. The light turns in the same axes, thus the axes are not important.
      float luma = 0.5;
      vec3 normal = vec3(0.0, 0.0, 1.0);
      vec2 uv;
      if ( baseUv(vUvs, uv) ) {
        luma = baseLuma(uv);
        vec2 dx = vec2(baseTexelSize.x * RELIEF_STEP, 0.0);
        vec2 dy = vec2(0.0, baseTexelSize.y * RELIEF_STEP);
        float slopeX = baseLuma(uv + dx) - baseLuma(uv - dx);
        float slopeY = baseLuma(uv + dy) - baseLuma(uv - dy);
        normal = normalize(vec3(-slopeX * BUMP, -slopeY * BUMP, 1.0));
      }

      // The eye is above the camera center. Thus a pixel away from the center sees the metal at an angle.
      // The offset is in scene axes, the same as the normal.
      vec2 offset = ((baseMatrix * vec3(vUvs, 1.0)).xy * viewTransform.xy) + viewTransform.zw;
      vec3 view = normalize(vec3(-offset * VIEW_TILT, 1.0));

      // A light that turns slowly around the area.
      float angle = phase * 0.5;
      vec3 light = normalize(vec3(cos(angle), sin(angle), 1.2));
      float diffuse = 0.6 + (0.4 * max(dot(normal, light), 0.0));
      float specular = pow(max(dot(reflect(-light, normal), view), 0.0), 32.0);

      // A soft diagonal shine band. One band each 2 grid squares at pattern scale 1.
      // It moves with the time and with the camera.
      vec2 pos = patternPos();
      float band = fract(((pos.x + pos.y) * 0.35) - (phase * 0.2) + ((offset.x + offset.y) * BAND_PARALLAX)) - 0.5;
      float shine = exp(-(band * band) / 0.0128);

      // More contrast than the map, but a dark map area does not become black, so that it stays metal.
      float tone = 0.35 + (0.65 * smoothstep(0.1, 0.9, luma));
      vec3 metal = effectColor * tone * diffuse;
      // The highlights are a mix of white and the tint, as on a real metal.
      metal += mix(vec3(1.0), effectColor, 0.3) * specular * 0.8;
      metal += mix(vec3(1.0), effectColor, 0.5) * shine * 0.35;
      // The color must not be more than the alpha, because the output is premultiplied.
      metal = min(metal, vec3(1.0));
      // tintAlpha.a is the mesh alpha, for example 0.5 for a hidden tile.
      return vec4(metal * s, s) * tintAlpha.a;
    }
  `;
  }

  /** @override */
  _preRender(mesh, renderer) {
    super._preRender(mesh, renderer);
    // The view radius is half of the longer screen side, in scene pixels. One value for both axes, so that the offset does not stretch.
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
