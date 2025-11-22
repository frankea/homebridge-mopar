/**
 * Automated Authentication Module
 *
 * Handles automatic login to Mopar.com using Puppeteer
 * to bypass Gigya's bot detection and cookie expiration issues.
 */

const puppeteer = require('puppeteer');

class MoparAuth {
  constructor(email, password, log = console.log, debugMode = false) {
    this.email = email;
    this.password = password;
    this.log = log;
    this.debugMode = debugMode;
    this.cookies = null;
    this.lastLogin = null;
  }

  // Debug logging helper
  debug(message) {
    if (this.debugMode) {
      this.log(`[DEBUG] ${message}`);
    }
  }

  /**
   * Login to Mopar.com and extract authentication cookies
   * @returns {Object} Cookie object with all necessary cookies
   */
  async login() {
    this.log('Starting automated login...');

    // Try to find Chrome in common locations
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
    };

    const chromePaths = [
      // Puppeteer cache for various users
      path.join(os.homedir(), '.cache/puppeteer/chrome/linux-141.0.7390.54/chrome-linux64/chrome'),
      '/root/.cache/puppeteer/chrome/linux-141.0.7390.54/chrome-linux64/chrome',
      '/var/lib/homebridge/.cache/puppeteer/chrome/linux-141.0.7390.54/chrome-linux64/chrome',
      '/home/homebridge/.cache/puppeteer/chrome/linux-141.0.7390.54/chrome-linux64/chrome',
      // System installations
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/snap/bin/chromium',
      '/opt/google/chrome/chrome',
    ];

    for (const chromePath of chromePaths) {
      if (fs.existsSync(chromePath)) {
        launchOptions.executablePath = chromePath;
        this.log(`Using Chrome at: ${chromePath}`);
        break;
      }
    }

    const browser = await puppeteer.launch(launchOptions);

    try {
      const page = await browser.newPage();

      // Set realistic viewport and user agent
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      this.log('  Navigating to login page...');
      await page.goto('https://www.mopar.com/en-us/sign-in.html', {
        waitUntil: 'networkidle2',
        timeout: 60000, // Increased for slower devices
      });

      // Wait for Gigya login form to load
      this.log('  Waiting for login form...');
      await page.waitForSelector('input[name="username"]', { timeout: 20000 }); // Increased timeout
      await page.waitForSelector('input[name="password"]', { timeout: 20000 });

      // Wait for form to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Fill in credentials - with verification
      this.debug('Entering credentials...');

      // Method 1: Try clicking and typing (most realistic)
      let emailEntered = false;
      try {
        await page.click('input[name="username"]');
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.type('input[name="username"]', this.email, { delay: 50 });
        emailEntered = true;
      } catch (error) {
        this.debug(`Click/type method failed: ${error.message}`);
      }

      // Method 2: Direct JavaScript injection if Method 1 failed
      if (!emailEntered) {
        this.debug('Using JavaScript to fill email field...');
        await page.evaluate((email) => {
          const field = document.querySelector('input[name="username"]');
          field.value = email;
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
        }, this.email);
      }

      // Verify email was entered
      const emailValue = await page.$eval('input[name="username"]', (el) => el.value);
      this.debug(`Email field value: "${emailValue}"`);
      if (!emailValue || emailValue.length === 0) {
        throw new Error('Failed to enter email address');
      }

      // Fill password field
      let passwordEntered = false;
      try {
        await page.click('input[name="password"]');
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.type('input[name="password"]', this.password, { delay: 50 });
        passwordEntered = true;
      } catch (error) {
        this.debug(`Click/type method failed for password: ${error.message}`);
      }

      // Method 2: Direct JavaScript injection if Method 1 failed
      if (!passwordEntered) {
        this.debug('Using JavaScript to fill password field...');
        await page.evaluate((password) => {
          const field = document.querySelector('input[name="password"]');
          field.value = password;
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
        }, this.password);
      }

      // Verify password was entered (check length, not actual value)
      const passwordValue = await page.$eval('input[name="password"]', (el) => el.value);
      this.debug(`Password field length: ${passwordValue.length}`);
      if (!passwordValue || passwordValue.length === 0) {
        throw new Error('Failed to enter password');
      }

      // Trigger form validation events that Gigya expects
      this.debug('Triggering form validation...');
      await page.evaluate(() => {
        const usernameField = document.querySelector('input[name="username"]');
        const passwordField = document.querySelector('input[name="password"]');

        // Fire all events that Gigya might be listening for
        const events = ['input', 'change', 'blur', 'keyup'];
        events.forEach((eventType) => {
          if (usernameField) {
            usernameField.dispatchEvent(new Event(eventType, { bubbles: true, cancelable: true }));
          }
          if (passwordField) {
            passwordField.dispatchEvent(new Event(eventType, { bubbles: true, cancelable: true }));
          }
        });
      });

      // Wait for validation to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Take screenshot before submitting to verify credentials are filled
      const beforeSubmitPath = '/tmp/mopar-before-submit.png';
      await page.screenshot({ path: beforeSubmitPath, fullPage: true });
      this.debug(`Screenshot before submit saved to: ${beforeSubmitPath}`);

      // Submit the form - try pressing Enter first (most reliable)
      this.log('  Submitting login...');

      // Wait a moment for any JavaScript to finish loading
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Enable request and response monitoring
      let formSubmitted = false;

      const submissionListener = (request) => {
        const url = request.url();
        const method = request.method();
        if (method === 'POST' && (url.includes('accounts.login') || url.includes('signin') || url.includes('login'))) {
          formSubmitted = true;
          this.debug(`Form POST detected: ${url}`);
        }
      };

      const responseListener = async (response) => {
        const url = response.url();
        if (url.includes('accounts.login') || url.includes('socialize.login')) {
          try {
            const text = await response.text();
            this.debug(`Login API response received (${response.status()}): ${text.substring(0, 200)}...`);

            // Try to parse as JSON and extract error info
            try {
              const json = JSON.parse(text);
              if (json.errorCode) {
                this.log(`Gigya Error Code: ${json.errorCode}`);
                this.log(`Gigya Error Message: ${json.errorMessage || json.errorDetails || 'Unknown error'}`);
              }
              if (json.statusCode) {
                this.debug(`Gigya Status Code: ${json.statusCode}`);
              }
            } catch (e) {
              // Not JSON, that's okay
            }
          } catch (e) {
            this.debug(`Could not read response body: ${e.message}`);
          }
        }
      };

      page.on('request', submissionListener);
      page.on('response', responseListener);

      // Method 1: Press Enter in password field (most reliable)
      let submitMethod = 'none';
      try {
        await page.focus('input[name="password"]');
        await page.keyboard.press('Enter');
        submitMethod = 'enter-key';
        this.debug('Pressed Enter to submit form');
      } catch (error) {
        this.debug(`Enter press failed: ${error.message}, trying click method...`);
      }

      // Wait a bit to see if Enter worked
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Try multiple selectors and click strategies if Enter didn't work
      if (submitMethod === 'none' || !formSubmitted) {
        const selectors = [
          'input[type="submit"][value="Sign In"]',
          'input[type="submit"]',
          'button[type="submit"]',
          '.gigya-input-submit',
          'input.gigya-input-submit',
        ];

        let clicked = false;
        for (const selector of selectors) {
          try {
            const button = await page.$(selector);
            if (button) {
              // Check if button is visible and enabled
              const buttonInfo = await page.evaluate((el) => {
                const style = window.getComputedStyle(el);
                return {
                  visible: style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
                  disabled: el.disabled,
                  text: el.value || el.textContent,
                };
              }, button);

              this.debug(
                `Found submit button (${selector}): visible=${buttonInfo.visible}, disabled=${buttonInfo.disabled}, text="${buttonInfo.text}"`
              );

              if (buttonInfo.visible && !buttonInfo.disabled) {
                // Use JS click directly - regular click never works with Gigya forms
                await page.evaluate((el) => el.click(), button);
                clicked = true;
                submitMethod = `js-click-${selector}`;
                this.debug(`Clicked submit button using: ${selector}`);
                break;
              }
            }
          } catch (e) {
            // Try next selector
            continue;
          }
        }

        if (!clicked && submitMethod === 'none') {
          page.off('request', submissionListener);
          throw new Error('Could not find or click login button');
        }
      }

      // Wait a moment to see if form was submitted
      await new Promise((resolve) => setTimeout(resolve, 500));

      // If form still hasn't submitted, try direct form submission
      if (!formSubmitted) {
        this.debug('Form POST not detected, trying direct Gigya API submission...');

        const formSubmitResult = await page.evaluate(() => {
          return new Promise((resolve) => {
            const form = document.querySelector('form');
            if (form) {
              // Try to find and call Gigya's submit handler with callbacks
              if (typeof gigya !== 'undefined' && gigya.accounts && gigya.accounts.login) {
                const usernameField = document.querySelector('input[name="username"]');
                const passwordField = document.querySelector('input[name="password"]');
                if (usernameField && passwordField) {
                  // Call Gigya's login API directly with event handlers
                  try {
                    // Set up event listeners for Gigya responses
                    window.gigyaLoginSuccess = false;
                    window.gigyaLoginError = null;

                    gigya.accounts.login({
                      loginID: usernameField.value,
                      password: passwordField.value,
                      callback: function (response) {
                        if (response.errorCode === 0) {
                          window.gigyaLoginSuccess = true;
                          resolve({ method: 'gigya-api', attempted: true, success: true });
                        } else {
                          window.gigyaLoginError = {
                            errorCode: response.errorCode,
                            errorMessage: response.errorMessage || response.errorDetails,
                          };
                          resolve({
                            method: 'gigya-api',
                            attempted: true,
                            success: false,
                            error: response.errorMessage || response.errorDetails,
                          });
                        }
                      },
                    });

                    // Timeout after 3 seconds if no callback
                    setTimeout(() => {
                      resolve({ method: 'gigya-api', attempted: true, timeout: true });
                    }, 3000);

                    return; // Wait for callback or timeout
                  } catch (e) {
                    resolve({ method: 'gigya-api', attempted: true, error: e.message });
                    return;
                  }
                }
              }

              // Fallback: Try native form submission
              try {
                form.submit();
                resolve({ method: 'form.submit()', attempted: true });
              } catch (e) {
                resolve({ method: 'form.submit()', attempted: true, error: e.message });
              }
            } else {
              resolve({ attempted: false, error: 'No form found' });
            }
          });
        });

        this.debug(`Direct submission result: ${JSON.stringify(formSubmitResult)}`);
        submitMethod = formSubmitResult.method || submitMethod;

        // If we got an error from Gigya, report it immediately
        if (formSubmitResult.error && formSubmitResult.success === false) {
          page.off('request', submissionListener);
          page.off('response', responseListener);
          throw new Error(`Login failed: ${formSubmitResult.error}`);
        }

        // Wait longer for submission to process (Gigya can be slow)
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      page.off('request', submissionListener);
      page.off('response', responseListener);

      this.debug(`Submit method used: ${submitMethod}`);
      this.debug(`Form POST detected: ${formSubmitted}`);

      // After successful Gigya login, check if we're authenticated
      this.debug('Checking for Gigya session...');

      // Wait for Gigya to set session cookies and UID
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const gigyaSession = await page.evaluate(() => {
        if (typeof gigya !== 'undefined' && gigya.accounts && gigya.accounts.getAccountInfo) {
          return new Promise((resolve) => {
            gigya.accounts.getAccountInfo({
              callback: function (response) {
                if (response.errorCode === 0 && response.UID) {
                  resolve({
                    authenticated: true,
                    uid: response.UID,
                    profile: response.profile || {},
                  });
                } else {
                  resolve({ authenticated: false, error: response.errorMessage });
                }
              },
            });

            // Timeout after 5 seconds
            setTimeout(() => {
              resolve({ authenticated: false, timeout: true });
            }, 5000);
          });
        }
        return { authenticated: false, noGigya: true };
      });

      this.debug(`Gigya session status: ${JSON.stringify(gigyaSession)}`);

      // If authenticated with Gigya, POST the UID to establish Mopar session
      if (gigyaSession.authenticated) {
        this.log('Gigya session established, posting UID to establish Mopar session...');

        try {
          // Get UID signature and timestamp from Gigya
          const gigyaData = await page.evaluate(() => {
            return new Promise((resolve) => {
              if (typeof gigya !== 'undefined' && gigya.accounts && gigya.accounts.getAccountInfo) {
                gigya.accounts.getAccountInfo({
                  include: 'loginIDs',
                  callback: function (response) {
                    if (response.errorCode === 0) {
                      resolve({
                        uid: response.UID,
                        uidSignature: response.UIDSignature,
                        signatureTimestamp: response.signatureTimestamp,
                      });
                    } else {
                      resolve(null);
                    }
                  },
                });
                setTimeout(() => resolve(null), 5000);
              } else {
                resolve(null);
              }
            });
          });

          if (gigyaData && gigyaData.uid && gigyaData.uidSignature) {
            this.debug('Got UID signature data');

            // Get CSRF token from page
            const csrfToken = await page.evaluate(() => {
              const input = document.querySelector('input[name=":cq_csrf_token"]');
              return input ? input.value : null;
            });

            if (csrfToken) {
              this.debug(`Got CSRF token: ${csrfToken.substring(0, 20)}...`);
            } else {
              this.debug('Warning: No CSRF token found on current page');
            }

            // Build form data for POST to /sign-in
            const formData = {
              UID: gigyaData.uid,
              UIDSignature: gigyaData.uidSignature,
              signatureTimestamp: gigyaData.signatureTimestamp.toString(),
            };

            if (csrfToken) {
              formData[':cq_csrf_token'] = csrfToken;
            }

            this.debug('Posting to /sign-in endpoint...');

            // Use page.evaluate to submit via form to properly follow redirect
            await page.evaluate((data) => {
              const form = document.createElement('form');
              form.method = 'POST';
              form.action = 'https://www.mopar.com/sign-in';

              for (const [key, value] of Object.entries(data)) {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = key;
                input.value = value;
                form.appendChild(input);
              }

              document.body.appendChild(form);
              form.submit();
            }, formData);

            // Wait for navigation after form submit (usually times out, we navigate manually)
            try {
              await page.waitForNavigation({
                waitUntil: 'networkidle2',
                timeout: 3000,
              });
              this.debug(`POST completed, navigated to: ${page.url()}`);
            } catch (e) {
              this.debug(`POST navigation timeout (expected): ${e.message}`);
            }

            // If we're not on a dashboard/vehicle page, try explicit navigation
            const currentUrl = page.url();
            if (!currentUrl.includes('my-vehicle') && !currentUrl.includes('dashboard')) {
              this.debug('Not on owner site, navigating explicitly...');
              await page.goto('https://www.mopar.com/chrysler/en-us/my-vehicle/dashboard.html', {
                waitUntil: 'networkidle2',
                timeout: 30000,
              });
            }

            this.debug('Successfully navigated to owner site');
          } else {
            this.log('  Warning: Could not get UID signature, trying direct navigation...');
            await page.goto('https://www.mopar.com/chrysler/en-us/my-vehicle/dashboard.html', {
              waitUntil: 'networkidle2',
              timeout: 30000,
            });
          }
        } catch (e) {
          this.log(`  Navigation to owner site failed: ${e.message}`);
        }
      } else {
        // Wait for automatic navigation
        this.log('  Waiting for automatic login navigation...');
        try {
          await page.waitForNavigation({
            waitUntil: 'networkidle2',
            timeout: 15000,
          });
        } catch (e) {
          this.log('  Navigation timeout, checking login status...');
        }
      }

      // Extra time for cookies to settle and API to initialize
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Try to trigger the vehicle data load to ensure session is fully active
      this.debug('Triggering vehicle data load...');
      try {
        await page.evaluate(() => {
          // Try to trigger any pending requests by scrolling
          window.scrollTo(0, 100);
        });
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (e) {
        this.log(`  Could not trigger data load: ${e.message}`);
      }

      // Check if login was successful
      const currentUrl = page.url();
      this.log(`  Current URL: ${currentUrl}`);

      // Even if we're on sign-in page, check if we have a valid Gigya session
      const isLoggedIn = !currentUrl.includes('sign-in') || gigyaSession.authenticated;

      if (!isLoggedIn) {
        // Still on sign-in page and no Gigya session, check for error messages
        this.log('  Still on sign-in page without Gigya session, checking for errors...');

        // Take a screenshot for debugging (saved to /tmp)
        const screenshotPath = '/tmp/mopar-login-error.png';
        try {
          await page.screenshot({ path: screenshotPath, fullPage: true });
          this.log(`  Screenshot saved to: ${screenshotPath}`);
        } catch (e) {
          // Screenshot failed, not critical
        }

        // Capture page title for diagnostics
        const pageTitle = await page.title();
        this.log(`  Page title: "${pageTitle}"`);

        // Get all visible text from potential error containers
        const diagnosticInfo = await page.evaluate(() => {
          const info = {
            allErrors: [],
            visibleText: '',
            formState: {},
            captchaInfo: {},
          };

          // Check all possible error selectors
          const errorSelectors = [
            '.gigya-error-msg',
            '.error-msg',
            '.gigya-error-msg-active',
            '[data-screenset-element-id*="error"]',
            '.gigya-composite-control-error',
            '.gigya-error',
            '[class*="error"][style*="display: block"]',
            '[class*="error"]:not([style*="display: none"])',
          ];

          errorSelectors.forEach((selector) => {
            const elements = document.querySelectorAll(selector);
            elements.forEach((el) => {
              const style = window.getComputedStyle(el);
              if (style.display !== 'none' && style.visibility !== 'hidden' && el.textContent.trim()) {
                info.allErrors.push({
                  selector: selector,
                  text: el.textContent.trim(),
                  html: el.innerHTML,
                });
              }
            });
          });

          // Get the main content area text
          const mainContent =
            document.querySelector('.gigya-screen-content') || document.querySelector('form') || document.body;
          if (mainContent) {
            info.visibleText = mainContent.textContent.substring(0, 500);
          }

          // Check form state
          const usernameField = document.querySelector('input[name="username"]');
          const passwordField = document.querySelector('input[name="password"]');
          const submitButton =
            document.querySelector('input[type="submit"]') || document.querySelector('button[type="submit"]');

          info.formState = {
            usernamePresent: !!usernameField,
            usernameValue: usernameField ? usernameField.value.substring(0, 5) + '...' : '',
            passwordPresent: !!passwordField,
            passwordLength: passwordField ? passwordField.value.length : 0,
            submitButtonPresent: !!submitButton,
            submitButtonDisabled: submitButton ? submitButton.disabled : null,
          };

          // Check for CAPTCHA elements with detailed info
          // Only check for ACTUAL captcha iframes and reCAPTCHA elements
          const captchaSelectors = [
            'iframe[src*="recaptcha"]',
            'iframe[src*="hcaptcha"]',
            'iframe[title*="captcha"]',
            '.g-recaptcha',
            '#g-recaptcha',
            'div[data-sitekey]', // reCAPTCHA div with data-sitekey
          ];

          captchaSelectors.forEach((selector) => {
            const elements = document.querySelectorAll(selector);
            elements.forEach((el) => {
              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              const actuallyVisible =
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0' &&
                rect.width > 0 &&
                rect.height > 0;

              if (actuallyVisible) {
                info.captchaInfo[selector] = {
                  found: true,
                  visible: true,
                  display: style.display,
                  visibility: style.visibility,
                  opacity: style.opacity,
                  dimensions: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
                  innerHTML: el.innerHTML.substring(0, 200),
                };
              }
            });
          });

          return info;
        });

        // Log all diagnostic information
        this.log('  === DIAGNOSTIC INFORMATION ===');
        this.log(`  Errors found: ${diagnosticInfo.allErrors.length}`);
        diagnosticInfo.allErrors.forEach((err, idx) => {
          this.log(`    Error ${idx + 1} (${err.selector}): ${err.text}`);
        });

        this.log('  Form state:');
        this.log(`    Username field present: ${diagnosticInfo.formState.usernamePresent}`);
        this.log(`    Username value: ${diagnosticInfo.formState.usernameValue}`);
        this.log(`    Password field present: ${diagnosticInfo.formState.passwordPresent}`);
        this.log(`    Password length: ${diagnosticInfo.formState.passwordLength}`);
        this.log(`    Submit button present: ${diagnosticInfo.formState.submitButtonPresent}`);
        this.log(`    Submit button disabled: ${diagnosticInfo.formState.submitButtonDisabled}`);

        const captchaCount = Object.keys(diagnosticInfo.captchaInfo).length;
        this.log(`  CAPTCHA elements found: ${captchaCount}`);
        Object.entries(diagnosticInfo.captchaInfo).forEach(([selector, info]) => {
          this.log(`    ${selector}: visible=${info.visible}, display=${info.display}, visibility=${info.visibility}`);
        });

        if (diagnosticInfo.visibleText) {
          this.log(`  Visible text sample: ${diagnosticInfo.visibleText.substring(0, 200)}...`);
        }

        this.log('  === END DIAGNOSTICS ===');

        // Save HTML content for manual inspection
        const htmlPath = '/tmp/mopar-login-error.html';
        try {
          const pageContent = await page.content();
          const fs = require('fs');
          fs.writeFileSync(htmlPath, pageContent);
          this.log(`  Page HTML saved to: ${htmlPath}`);
        } catch (e) {
          this.log(`  Failed to save HTML: ${e.message}`);
        }

        // If we found an error message, report it
        if (diagnosticInfo.allErrors.length > 0) {
          const primaryError = diagnosticInfo.allErrors[0].text;
          throw new Error(`Login failed: ${primaryError}`);
        }

        // Check if any CAPTCHA elements are actually visible
        const visibleCaptchas = Object.keys(diagnosticInfo.captchaInfo);
        if (visibleCaptchas.length > 0) {
          this.log('  WARNING: Possible CAPTCHA elements detected, but they may be false positives');
          Object.entries(diagnosticInfo.captchaInfo).forEach(([selector, info]) => {
            this.log(`    ${selector}: ${info.dimensions}`);
          });
          // Only throw if it's an actual reCAPTCHA iframe
          const hasRealCaptcha = visibleCaptchas.some(
            (s) => s.includes('iframe[src*="recaptcha"]') || s.includes('iframe[src*="hcaptcha"]')
          );
          if (hasRealCaptcha) {
            throw new Error('Login blocked by CAPTCHA. Please try logging in manually through a browser first.');
          }
        }

        // Check for verification requirement
        const pageContent = await page.content();
        if (pageContent.includes('verify your email') || pageContent.includes('Verify your email')) {
          throw new Error('Account verification required. Please check your email or try logging in manually.');
        }

        // Generic failure message with helpful debugging info
        throw new Error(
          'Login failed: Still on sign-in page. Check credentials or review diagnostics above. Screenshots saved to /tmp/mopar-login-error.png and HTML to /tmp/mopar-login-error.html'
        );
      }

      // If we have a Gigya session but still on sign-in URL, try once more to navigate
      if (gigyaSession.authenticated && currentUrl.includes('sign-in')) {
        this.log('  Have Gigya session but still on sign-in page, attempting final navigation...');
        try {
          await page.goto('https://www.mopar.com/en-us/my-vehicle.html', {
            waitUntil: 'domcontentloaded',
            timeout: 10000,
          });
          this.log(`  Final navigation complete, now at: ${page.url()}`);
        } catch (e) {
          this.log(`  Final navigation attempt failed, but continuing with Gigya session: ${e.message}`);
        }
      }

      this.log('Login successful, extracting cookies...');

      // Extract all cookies from all domains
      const browserCookies = await page.cookies();

      // Log all cookie domains for debugging
      const domains = [...new Set(browserCookies.map((c) => c.domain))];
      this.debug(`Cookie domains found: ${domains.join(', ')}`);

      // Convert to simple object format
      this.cookies = {};
      const allowedDomains = ['mopar.com', 'gigya.com', 'stellantis.com'];
      browserCookies.forEach((cookie) => {
        // Save cookies from allowed domains
        // Check if cookie domain ends with or equals any allowed domain
        const isAllowed = allowedDomains.some(
          (domain) => cookie.domain === domain || cookie.domain === `.${domain}` || cookie.domain.endsWith(`.${domain}`)
        );
        if (isAllowed) {
          this.cookies[cookie.name] = cookie.value;
        }
      });

      this.log(`Extracted ${Object.keys(this.cookies).length} cookies`);

      // Log cookie names for debugging
      const cookieNames = Object.keys(this.cookies).sort();
      this.debug(`Cookie names: ${cookieNames.join(', ')}`);

      // Check if we have the Gigya login token
      const hasGltToken = cookieNames.some((name) => name.startsWith('glt_'));
      if (!hasGltToken) {
        this.log('  WARNING: No glt_ cookie found, attempting to extract from Gigya session...');

        // Try to get login token from Gigya API
        try {
          const gigyaToken = await page.evaluate(() => {
            if (typeof gigya !== 'undefined' && gigya.accounts && gigya.accounts.getAccountInfo) {
              return new Promise((resolve) => {
                gigya.accounts.getAccountInfo({
                  callback: function (response) {
                    if (response.errorCode === 0) {
                      // Look for login token in various places
                      const token = response.sessionInfo?.login_token || response.login_token || response.loginToken;
                      resolve(token || null);
                    } else {
                      resolve(null);
                    }
                  },
                });

                setTimeout(() => resolve(null), 5000);
              });
            }
            return null;
          });

          if (gigyaToken) {
            this.log(`  Extracted login token from Gigya API: ${gigyaToken.substring(0, 20)}...`);
            // Add it as a cookie in the expected format
            this.cookies[`glt_${Date.now()}`] = gigyaToken;
          } else {
            this.log('  Could not extract login token from Gigya API');
          }
        } catch (e) {
          this.log(`  Failed to extract Gigya token: ${e.message}`);
        }
      }

      this.lastLogin = new Date();

      // Close browser without waiting (async cleanup)
      // We have the cookies, no need to wait for graceful shutdown
      browser.close().catch((e) => this.debug(`Browser close error (non-critical): ${e.message}`));

      return this.cookies;
    } catch (error) {
      // User-friendly error messages
      if (error.message.includes('net::ERR_NAME_NOT_RESOLVED') || error.code === 'ENOTFOUND') {
        this.log.error('Cannot reach Mopar.com - Check your internet connection');
      } else if (error.message.includes('timeout') || error.message.includes('Navigation timeout')) {
        this.log.error('Login timed out - Mopar.com may be slow or unreachable');
        this.log.error('Try again in a few minutes or check https://www.mopar.com/en-us/sign-in.html');
      } else if (error.message.includes('ERR_CERT')) {
        this.log.error('SSL/Certificate error - Check your system time and date settings');
      } else if (error.message.includes('Execution context was destroyed')) {
        this.log.error('Browser session crashed - This is usually temporary, try restarting Homebridge');
      } else {
        this.log.error(`Login failed: ${error.message}`);
        this.log.error('Please verify your Mopar.com credentials are correct');
      }

      this.debug(`Full error: ${error.stack}`);

      // Close browser on error
      if (browser) {
        browser.close().catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Check if cookies are still valid (less than 20 hours old)
   * @returns {boolean} True if cookies are valid
   */
  areCookiesValid() {
    if (!this.cookies || !this.lastLogin) {
      return false;
    }

    const hoursSinceLogin = (Date.now() - this.lastLogin.getTime()) / (1000 * 60 * 60);
    return hoursSinceLogin < 20; // Refresh before 24hr expiration
  }

  /**
   * NOTE: Currently unused - login() is called directly instead
   * Get cookies, refreshing if necessary
   * @returns {Object} Valid cookie object
   */
  async getCookies() {
    if (!this.areCookiesValid()) {
      this.log('Cookies expired or missing, logging in...');
      await this.login();
    }
    return this.cookies;
  }
}

module.exports = MoparAuth;
