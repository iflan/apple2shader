"use strict";

let screenEmu = (function () {
  // From AppleIIVideo.cpp

  let HORIZ_START = 16;
  let HORIZ_BLANK = (9 + HORIZ_START) // 25;
  let HORIZ_DISPLAY = 40;
  let HORIZ_TOTAL = (HORIZ_BLANK + HORIZ_DISPLAY) // 65;

  let CELL_WIDTH = 14;
  let CELL_HEIGHT = 8;

  let VERT_NTSC_START = 38;
  let VERT_PAL_START = 48;
  let VERT_DISPLAY = 192;

  let BLOCK_WIDTH = HORIZ_DISPLAY; // 40
  let BLOCK_HEIGHT = (VERT_DISPLAY / CELL_HEIGHT); // 24

  // From CanvasInterface.h

  let NTSC_FSC     = 315/88 * 1e6;         // 3579545 = 3.5 Mhz: Color Subcarrier
  let NTSC_4FSC    = 4 * NTSC_FSC;         // 14318180 = 14.3 Mhz
  let NTSC_HTOTAL  = (63+5/9) * 1e-6;
  let NTSC_HLENGTH = (52+8/9) * 1e-6;
  let NTSC_HHALF   = (35+2/3) * 1e-6;
  let NTSC_HSTART  = NTSC_HHALF - NTSC_HLENGTH/2;
  let NTSC_HEND    = NTSC_HHALF + NTSC_HLENGTH/2;
  let NTSC_VTOTAL  = 262;
  let NTSC_VLENGTH = 240;
  let NTSC_VSTART  = 19;
  let NTSC_VEND    = NTSC_VSTART + NTSC_VLENGTH;

  let PAL_FSC      = 4433618.75; // Color subcarrier
  let PAL_4FSC     = 4 * PAL_FSC;
  let PAL_HTOTAL   = 64e-6;
  let PAL_HLENGTH  = 52e-6;
  let PAL_HHALF    = (37+10/27) * 1e-6;
  let PAL_HSTART   = PAL_HHALF - PAL_HLENGTH / 2;
  let PAL_HEND     = PAL_HHALF + PAL_HLENGTH / 2;
  let PAL_VTOTAL   = 312;
  let PAL_VLENGTH  = 288;
  let PAL_VSTART   = 21;
  let PAL_VEND     = PAL_VSTART + PAL_VLENGTH;

  // From AppleIIVideo::updateTiming
  let ntscClockFrequency = NTSC_4FSC * HORIZ_TOTAL / 912;
  let ntscVisibleRect = [[ntscClockFrequency * NTSC_HSTART, NTSC_VSTART],
			 [ntscClockFrequency * NTSC_HLENGTH, NTSC_VLENGTH]];
  let ntscDisplayRect = [[HORIZ_START, VERT_NTSC_START],
			 [HORIZ_DISPLAY, VERT_DISPLAY]];
  let ntscVertTotal = NTSC_VTOTAL;

  let palClockFrequency = 14250450.0 * HORIZ_TOTAL / 912;
  let palVisibleRect = [[palClockFrequency * PAL_HSTART, PAL_VSTART],
			[palClockFrequency * PAL_HLENGTH, PAL_VLENGTH]];
  let palDisplayRect = [[HORIZ_START, VERT_PAL_START],
			[HORIZ_DISPLAY, VERT_DISPLAY]];
  let palVertTotal = PAL_VTOTAL;

  const COMPOSITE_SHADER = `
uniform sampler2D texture;
uniform vec2 textureSize;
uniform float subcarrier;
uniform sampler1D phaseInfo;
uniform vec3 c0, c1, c2, c3, c4, c5, c6, c7, c8;
uniform mat3 decoderMatrix;
uniform vec3 decoderOffset;

float PI = 3.14159265358979323846264;

vec3 pixel(in vec2 q)
{
  vec3 c = texture2D(texture, q).rgb;
  vec2 p = texture1D(phaseInfo, q.y).rg;
  float phase = 2.0 * PI * (subcarrier * textureSize.x * q.x + p.x);
  return c * vec3(1.0, sin(phase), (1.0 - 2.0 * p.y) * cos(phase));
}

vec3 pixels(vec2 q, float i)
{
  return pixel(vec2(q.x + i, q.y)) + pixel(vec2(q.x - i, q.y));
}

void main(void)
{
  vec2 q = gl_TexCoord[0].st;
  vec3 c = pixel(q) * c0;
  c += pixels(q, 1.0 / textureSize.x) * c1;
  c += pixels(q, 2.0 / textureSize.x) * c2;
  c += pixels(q, 3.0 / textureSize.x) * c3;
  c += pixels(q, 4.0 / textureSize.x) * c4;
  c += pixels(q, 5.0 / textureSize.x) * c5;
  c += pixels(q, 6.0 / textureSize.x) * c6;
  c += pixels(q, 7.0 / textureSize.x) * c7;
  c += pixels(q, 8.0 / textureSize.x) * c8;
  gl_FragColor = vec4(decoderMatrix * c + decoderOffset, 1.0);
}
`;

  const DISPLAY_SHADER = `
uniform sampler2D texture;
uniform vec2 textureSize;
uniform float barrel;
uniform vec2 barrelSize;
uniform float scanlineLevel;
uniform sampler2D shadowMask;
uniform vec2 shadowMaskSize;
uniform float shadowMaskLevel;
uniform float centerLighting;
uniform sampler2D persistence;
uniform vec2 persistenceSize;
uniform vec2 persistenceOrigin;
uniform float persistenceLevel;
uniform float luminanceGain;

float PI = 3.14159265358979323846264;

void main(void)
{
  vec2 qc = (gl_TexCoord[1].st - vec2(0.5, 0.5)) * barrelSize;
  vec2 qb = barrel * qc * dot(qc, qc);
  vec2 q = gl_TexCoord[0].st + qb;

  vec3 c = texture2D(texture, q).rgb;

  float scanline = sin(PI * textureSize.y * q.y);
  c *= mix(1.0, scanline * scanline, scanlineLevel);

  vec3 mask = texture2D(shadowMask, (gl_TexCoord[1].st + qb) * shadowMaskSize).rgb;
  c *= mix(vec3(1.0, 1.0, 1.0), mask, shadowMaskLevel);

  vec2 lighting = qc * centerLighting;
  c *= exp(-dot(lighting, lighting));

  c *= luminanceGain;

  vec2 qp = gl_TexCoord[1].st * persistenceSize + persistenceOrigin;
  c = max(c, texture2D(persistence, qp).rgb * persistenceLevel - 0.5 / 256.0);

  gl_FragColor = vec4(c, 1.0);
}
`;

  function buildTiming(clockFrequency, displayRect, visibleRect, vertTotal) {
    let vertStart = displayRect[0][1];
    // Total number of CPU cycles per frame: 17030 for NTSC.
    let frameCycleNum = HORIZ_TOTAL * vertTotal;
    // first displayed column.
    let horizStart = Math.floor(displayRect[0][0]);
    // imageSize is [14 * visible rect width in cells, visible lines]
    let imageSize = [Math.floor(CELL_WIDTH * visibleRect[1][0]),
		     Math.floor(visibleRect[1][1])];
    // imageLeft is # of pixels from first visible point to first displayed point.
    let imageLeft = Math.floor((horizStart-visibleRect[0][0]) * CELL_WIDTH);
    let colorBurst = [2 * Math.PI * (-33/360 + (imageLeft % 4) / 4)];
    let cycleNum = frameCycleNum + 16;

    // First pixel that OpenEmulator draws when painting normally.
    let topLeft = [imageLeft, vertStart - visibleRect[0][1]];
    // First pixel that OpenEmulator draws when painting 80-column mode.
    let topLeft80Col = [imageLeft - CELL_WIDTH/2, vertStart - visibleRect[0][1]];

    return {
      clockFrequency: clockFrequency,
      displayRect: displayRect,
      visibleRect: visibleRect,
      vertStart: vertStart,
      vertTotal: vertTotal,
      frameCycleNum: frameCycleNum,
      horizStart: horizStart,
      imageSize: imageSize,
      imageLeft: imageLeft,
      colorBurst: colorBurst,
      cycleNum: cycleNum,
      topLeft: topLeft,
      topLeft80Col: topLeft80Col,
    };
  }

  // https://codereview.stackexchange.com/a/128619
  const loadImage = path =>
	new Promise((resolve, reject) => {
	  const img = new Image();
	  img.onload = () => resolve(img);
	  img.onerror = () => reject(`error loading '${path}'`);
	  img.src = path;
	});

  // Given an image that's 560x192, render it into the larger space
  // required for NTSC or PAL.
  // image: a 560x192 image, from the same domain (hence readable).
  // details: NTSC_DETAILS, or PAL_DETAILS
  // returns: a canvas
  const screenData = (image, details) => {
    if ((image.naturalWidth != 560) || (image.naturalHeight != 192)) {
      throw `screenData expects an image 560x192; got ${image.naturalWidth}x${image.naturalHeight}`;
    }
    let canvas = document.createElement('canvas');
    let context = canvas.getContext('2d');
    let width = details.imageSize[0];
    let height = details.imageSize[1];
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = 'rgba(0,0,0,1)';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, details.topLeft80Col[0], details.topLeft80Col[1]);
    // let myData = context.getImageData(0, 0, image.naturalWidth, image.naturalHeight);
    return canvas;
  };

  const TEXTURE_NAMES = [
    "SHADOWMASK_TRIAD",
    "SHADOWMASK_INLINE",
    "SHADOWMASK_APERTURE",
    "SHADOWMASK_LCD",
    "SHADOWMASK_BAYER",
    "IMAGE_PHASEINFO",
    "IMAGE_IN",
    "IMAGE_DECODED",
    "IMAGE_PERSISTENCE",
  ];

  const SHADER_NAMES = [
    "COMPOSITE",
    "DISPLAY",
  ];

  const TextureInfo = class {
    constructor(width, height, glTexture) {
      this.width = width;
      this.height = height;
      this.glTexture = glTexture;
    }
  };

  const ScreenView = class {
    constructor(gl) {
      this.gl = gl;
      this.textures = {};
      this.shaders = {};
    }

    async initOpenGL() {
      let gl = this.gl;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      this.textures = {};

      for (let name of TEXTURE_NAMES) {
	this.textures[name] = new TextureInfo(0, 0, gl.createTexture());
      }

      await this.loadTextures();

      gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

      this.loadShaders();
    }

    freeOpenGL() {
      let gl = this.gl;

      for (let name of TEXTURE_NAMES) {
	gl.deleteTexture(this.textures[name].glTexture);
      }

      this.deleteShaders();
    }

    loadTextures() {
      return Promise.all([
	this.loadTexture("textures/Shadow Mask Triad.png", true, "SHADOWMASK_TRIAD"),
	this.loadTexture("textures/Shadow Mask Inline.png", true, "SHADOWMASK_INLINE"),
	this.loadTexture("textures/Shadow Mask Aperture.png", true, "SHADOWMASK_APERTURE"),
	this.loadTexture("textures/Shadow Mask LCD.png", true, "SHADOWMASK_LCD"),
	this.loadTexture("textures/Shadow Mask Bayer.png", true, "SHADOWMASK_BAYER"),
      ]);
    }

    async loadTexture(path, isMipMap, name) {
      let gl = this.gl;
      let textureInfo = this.textures[name];
      let image = await loadImage(path);
      gl.bindTexture(gl.TEXTURE_2D, textureInfo.glTexture);

      // TODO(zellyn): implement
      if (isMipMap) {
        // gluBuild2DMipmaps(GL_TEXTURE_2D, GL_RGB8,
        //                   image.getSize().width, image.getSize().height,
        //                   getGLFormat(image.getFormat()),
        //                   GL_UNSIGNED_BYTE, image.getPixels());
      } else {
        // glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA,
        //              image.getSize().width, image.getSize().height,
        //              0,
        //              getGLFormat(image.getFormat()), GL_UNSIGNED_BYTE, image.getPixels());
      }

      textureInfo.width = image.naturalWidth;
      textureInfo.height = image.naturalHeight;
    }

    // TODO(zellyn): implement
    loadShaders() {
      this.loadShader("COMPOSITE", COMPOSITE_SHADER);
      this.loadShader("DISPLAY", DISPLAY_SHADER);
    }

    // TODO(zellyn): implement
    loadShader(name, source) {
      console.log(`ScreenView.loadShader(${name}): not implemented yet`);
    }

    // TODO(zellyn): implement
    deleteShaders() {
      for (let name of SHADER_NAMES) {
	if (this.shaders[name]) {
	  gl.deleteProgram(this.shaders[name]);
	  this.shaders[name] = false;
	}
      }
    }
  }

  // Resize the texture with the given name to the next
  // highest power of two width and height. Wouldn't be
  // necessary with webgl2.
  const resizeTexture = (gl, textures, name, width, height) => {
    let textureInfo = textures[name];
    if (!!textureInfo) {
      throw `Cannot find texture named ${name}`;
    }
    if (width < 4) width = 4;
    if (height < 4) height = 4;
    width = 2**Math.ceil(Math.log2(width));
    height = 2**Math.ceil(Math.log2(height));
    textureInfo.width = width;
    textureInfo.height = height;
    gl.bindTexture(gl.TEXTURE_2D, textureInfo.glTexture);
    const dummy = new Uint8Array(width * height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, width, height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, dummy);
  };

  const vsync = (gl) => {
    // if viewport size has changed:
    // glViewPort(0, 0, new_width, new_height);

    // if image updated:
    // uploadImage();

    // if configuration updated:
    // configureShaders();

    // if image or configuration updated:
    // renderImage();

    // if anything updated, or displayPersistence != 0.0
    // drawDisplayCanvas();
  };

  // TODO(zellyn): implement
  const uploadImage = (gl) => {
  };

  // TODO(zellyn): implement
  const configureShaders = (gl) => {
  };

  // TODO(zellyn): implement
  const renderImage = (gl) => {
  };

  // TODO(zellyn): implement
  const drawDisplayCanvas = (gl) => {
  };

  return {
    C: {
      HORIZ_START: HORIZ_START,
      HORIZ_BLANK: HORIZ_BLANK,
      HORIZ_DISPLAY: HORIZ_DISPLAY,
      HORIZ_TOTAL: HORIZ_TOTAL,
      CELL_WIDTH: CELL_WIDTH,
      CELL_HEIGHT: CELL_HEIGHT,
      VERT_NTSC_START: VERT_NTSC_START,
      VERT_PAL_START: VERT_PAL_START,
      VERT_DISPLAY: VERT_DISPLAY,
      BLOCK_WIDTH: BLOCK_WIDTH,
      BLOCK_HEIGHT: BLOCK_HEIGHT,
      NTSC_DETAILS: buildTiming(ntscClockFrequency, ntscDisplayRect,
				ntscVisibleRect, ntscVertTotal),
      PAL_DETAILS: buildTiming(palClockFrequency, palDisplayRect,
			       palVisibleRect, palVertTotal),
    },
    loadImage: loadImage,
    screenData: screenData,
    resizeTexture: resizeTexture,
    getScreenView: (gl) => new ScreenView(gl),
  };
})();
