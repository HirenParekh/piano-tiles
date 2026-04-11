import Phaser from 'phaser';

export class GrayscalePipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game: Phaser.Game) {
    super({
      game,
      name: 'Grayscale',
      fragShader: `
        precision mediump float;
        uniform sampler2D uMainSampler;
        varying vec2 outTexCoord;
        void main() {
          vec4 color = texture2D(uMainSampler, outTexCoord);
          float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
          gl_FragColor = vec4(gray, gray, gray, color.a);
        }
      `
    });
  }
}
