import * as TypeExports from ".";
import * as NodeExports from "./node";
import * as WebExports from "./web";

describe("exports", () => {
  it("matches web and node exports", () => {
    // Remove exports that are implemented differently between Node and Web.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { open: _typeOpen, ...TypeSharedExports } = TypeExports;
    const { open: nodeOpen, Reader: NodeReader, ...NodeSharedExports } = NodeExports;
    const { open: webOpen, Reader: WebReader, ...WebSharedExports } = WebExports;

    expect(nodeOpen).toEqual(expect.any(Function));
    expect(NodeReader).toEqual(expect.any(Function));
    expect(webOpen).toEqual(expect.any(Function));
    expect(WebReader).toEqual(expect.any(Function));

    expect(NodeSharedExports).toEqual(TypeSharedExports);
    expect(WebSharedExports).toEqual(TypeSharedExports);
  });
});
