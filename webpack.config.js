const path = require("path");
const nodeExternals = require("webpack-node-externals");

const target = process.env.ROSBAG_TARGET;

module.exports = {
  entry: `./src/${target}/index.js`,
  devtool: "inline-source-map",
  module: {
    rules: [
      {
        test: /\.js$/,
        use: {
          loader: "babel-loader",
        },
        exclude: /node_modules/,
      },
    ],
  },
  output: {
    filename: "index.js",
    path: path.resolve(__dirname, `dist/${target}`),
    library: "rosbag",
    libraryTarget: "umd",
  },
  target,
  externals: target === "node" ? [nodeExternals()] : undefined,
};
