const mockChalk = new Proxy((x) => x, {
  get: (target, prop) => {
    if (prop === "default") return mockChalk;
    return mockChalk;
  }
});
module.exports = mockChalk;
