declare module '@ffmpeg-installer/ffmpeg' {
  const ffmpeg: {
    path: string;
    version: string;
    url: string;
  };
  export default ffmpeg;
}

declare module 'js-aruco2' {
  export const AR: {
    Dictionary: new (name: string) => { generateSVG(id: number): string };
    Detector: new (options: {
      dictionaryName: string;
      maxHammingDistance: number;
    }) => {
      detect(image: {
        width: number;
        height: number;
        data: Uint8Array;
      }): Array<{ id: number; corners: Array<{ x: number; y: number }> }>;
    };
  };
}
