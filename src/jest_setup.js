import { TextDecoder } from "text-encoding";

if (typeof window !== "undefined") {
  global.TextDecoder = TextDecoder;
}
