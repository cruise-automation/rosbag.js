declare module "compressjs" {
  interface Bzip2 {
    decompressFile(buff: Buffer): Buffer;
  }

  export const Bzip2: Bzip2;
}
