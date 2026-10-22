import { getRainCanvasPixelSize } from "./rainVisualEngine";

const VERTEX_SHADER = `
attribute vec2 aPosition;
attribute float aOpacity;
varying float vOpacity;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vOpacity = aOpacity;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying float vOpacity;
void main() {
  gl_FragColor = vec4(0.76, 0.88, 0.97, vOpacity * 0.82);
}
`;

export type RainWebGLRenderer = {
  resize: (cssWidth: number, cssHeight: number, devicePixelRatio: number) => void;
  draw: (vertices: Float32Array) => void;
  dispose: () => void;
};

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function createRainWebGLRenderer(canvas: HTMLCanvasElement): RainWebGLRenderer | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: "low-power",
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
  } catch {
    return null;
  }
  if (!gl) return null;

  let vertexShader: WebGLShader | null = null;
  let fragmentShader: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let positionLocation = -1;
  let opacityLocation = -1;
  let allocatedBytes = 0;

  const cleanup = () => {
    if (buffer) gl?.deleteBuffer(buffer);
    if (program) gl?.deleteProgram(program);
    if (vertexShader) gl?.deleteShader(vertexShader);
    if (fragmentShader) gl?.deleteShader(fragmentShader);
    buffer = null;
    program = null;
    vertexShader = null;
    fragmentShader = null;
  };

  try {
    vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) throw new Error("Compilation du shader pluie impossible.");

    program = gl.createProgram();
    buffer = gl.createBuffer();
    if (!program || !buffer) throw new Error("Ressources WebGL pluie indisponibles.");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("Liaison du shader pluie impossible.");
    }

    positionLocation = gl.getAttribLocation(program, "aPosition");
    opacityLocation = gl.getAttribLocation(program, "aOpacity");
    if (positionLocation < 0 || opacityLocation < 0) {
      throw new Error("Attribut WebGL pluie absent.");
    }

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 3 * Float32Array.BYTES_PER_ELEMENT, 0);
    gl.enableVertexAttribArray(opacityLocation);
    gl.vertexAttribPointer(opacityLocation, 1, gl.FLOAT, false, 3 * Float32Array.BYTES_PER_ELEMENT, 2 * Float32Array.BYTES_PER_ELEMENT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);

    return {
      resize: (cssWidth, cssHeight, devicePixelRatio) => {
        if (gl!.isContextLost()) return;
        const pixelSize = getRainCanvasPixelSize(cssWidth, cssHeight, devicePixelRatio);
        if (canvas.width !== pixelSize.width || canvas.height !== pixelSize.height) {
          canvas.width = pixelSize.width;
          canvas.height = pixelSize.height;
        }
        gl!.viewport(0, 0, pixelSize.width, pixelSize.height);
      },
      draw: (vertices) => {
        if (gl!.isContextLost()) return;
        gl!.useProgram(program);
        gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
        if (vertices.byteLength > allocatedBytes) {
          allocatedBytes = vertices.byteLength;
          gl!.bufferData(gl!.ARRAY_BUFFER, allocatedBytes, gl!.DYNAMIC_DRAW);
        }
        gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, vertices);
        gl!.clear(gl!.COLOR_BUFFER_BIT);
        gl!.drawArrays(gl!.TRIANGLES, 0, vertices.length / 3);
      },
      dispose: cleanup,
    };
  } catch {
    cleanup();
    return null;
  }
}
