module.exports = {
  plugins: ["@babel/plugin-syntax-object-rest-spread"],
  presets: ["@babel/preset-flow"],
  env: {
    test: {
      plugins: ["@babel/plugin-proposal-class-properties"],
      presets: ["@babel/preset-env"],
    },
  },
};
