const { expect } = require('@playwright/test');

async function expectTextContrast(locator, minimum = 4.5) {
  await expect(locator).toBeVisible();
  const result = await locator.evaluate(element => {
    const context = document.createElement('canvas').getContext('2d');
    const color = css => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v);
    };
    const over = (foreground, background) => [
      ...foreground.slice(0, 3).map((value, index) => value * foreground[3] + background[index] * (1 - foreground[3])), 1,
    ];
    const backgrounds = node => {
      if (!node) return [[255, 255, 255, 1]];
      const style = getComputedStyle(node);
      const own = color(style.backgroundColor);
      const under = own[3] === 1 ? [own] : backgrounds(node.parentElement).map(bg => over(own, bg));
      // Compare both ends of painted gradients, including translucent paper
      // textures. Opaque paper stops traversal before the decorative wood.
      const stops = style.backgroundImage.match(/rgba?\([^)]*\)|color\([^)]*\)/g)?.map(color) || [];
      return stops.length ? under.flatMap(bg => stops.map(stop => over(stop, bg))).slice(0, 64) : under;
    };
    const luminance = rgb => rgb.slice(0, 3).map(value => {
      const s = value / 255;
      return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const foreground = color(getComputedStyle(element).color);
    const ratios = backgrounds(element).map(background => {
      const a = luminance(over(foreground, background));
      const b = luminance(background);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
    return { text: element.textContent.trim(), minimum: Math.min(...ratios) };
  });
  expect(result.minimum, `Text contrast for "${result.text}"`).toBeGreaterThanOrEqual(minimum);
}

module.exports = { expectTextContrast };
