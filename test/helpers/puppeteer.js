const puppeteer = require('puppeteer');

const createMockKeyboard = () => ({
  down: jest.fn().mockResolvedValue(),
  press: jest.fn().mockResolvedValue(),
  up: jest.fn().mockResolvedValue(),
});

const createMockPage = (overrides = {}) => {
  const page = {
    setViewport: jest.fn().mockResolvedValue(),
    setUserAgent: jest.fn().mockResolvedValue(),
    goto: jest.fn().mockResolvedValue(),
    waitForSelector: jest.fn().mockResolvedValue(),
    waitForNavigation: jest.fn().mockResolvedValue(),
    click: jest.fn().mockResolvedValue(),
    type: jest.fn().mockResolvedValue(),
    focus: jest.fn().mockResolvedValue(),
    keyboard: createMockKeyboard(),
    $: jest.fn().mockResolvedValue({}),
    $eval: jest.fn(),
    evaluate: jest.fn().mockResolvedValue({}),
    on: jest.fn(),
    off: jest.fn(),
    url: jest.fn().mockReturnValue('https://www.mopar.com/chrysler/en-us/my-vehicle/dashboard.html'),
    title: jest.fn().mockResolvedValue('Mopar'),
    cookies: jest.fn().mockResolvedValue([]),
    screenshot: jest.fn().mockResolvedValue(),
    content: jest.fn().mockResolvedValue('<html></html>'),
  };

  return Object.assign(page, overrides);
};

const createMockBrowser = (page = createMockPage(), overrides = {}) =>
  Object.assign(
    {
      newPage: jest.fn().mockResolvedValue(page),
      close: jest.fn().mockResolvedValue(),
      pages: jest.fn().mockResolvedValue([page]),
    },
    overrides
  );

const mockPuppeteerLaunch = (browser) => puppeteer.launch.mockResolvedValue(browser);

module.exports = {
  createMockPage,
  createMockBrowser,
  mockPuppeteerLaunch,
};
