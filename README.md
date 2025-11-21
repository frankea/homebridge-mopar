# homebridge-mopar

[![npm version](https://badge.fury.io/js/homebridge-mopar.svg)](https://badge.fury.io/js/homebridge-mopar)
[![Test](https://github.com/frankea/homebridge-mopar/workflows/Test/badge.svg)](https://github.com/frankea/homebridge-mopar/actions/workflows/test.yml)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

> ⚠️ **Beta Status**: Currently tested on 2022 Chrysler Pacifica. Should work with other Mopar vehicles (Dodge, Jeep, Ram, Fiat, Alfa Romeo), but additional testing is needed. Please report your results!

Control your Mopar vehicle (Chrysler, Dodge, Jeep, Ram, Fiat, Alfa Romeo) through HomeKit using Uconnect!

## Background

This plugin was created to replace [homebridge-uconnect](https://github.com/gyahalom/homebridge-uconnect) which stopped working due to Mopar's authentication system changes and hasn't been updated since 2022. If you're currently using that plugin, this is the modern replacement with:
- ✅ Updated authentication that works with current Mopar systems
- ✅ Automated login using Puppeteer (no manual cookie extraction)
- ✅ Fast startup with intelligent caching
- ✅ Background refresh for reliability
- ✅ Active maintenance and support

## Features

- Lock/Unlock doors (requires valid PIN)
- Remote Start/Stop engine (requires valid PIN)
- Horn & Lights activation (requires valid PIN)
- Climate control (requires valid PIN)
- Battery status monitoring
- Door sensors (contact sensors for all doors)
- Automated authentication with proactive session refresh (50 minutes + 20 hours)
- Fast startup with intelligent caching (accessories available in ~5 seconds)
- Background API refresh for maximum reliability
- Commands always succeed immediately (no waiting for re-authentication)
- Full Siri voice control integration

## Installation

### Via Homebridge UI (Recommended)

1. Search for "homebridge-mopar" in the Homebridge UI plugin search
2. Click Install
3. Configure using the settings form

### Via npm

```bash
npm install -g homebridge-mopar
```

## Configuration

Add the following to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "Mopar",
      "name": "Mopar",
      "email": "your-email@example.com",
      "password": "your-password",
      "pin": "1234"
    }
  ]
}
```

### Configuration Options

| Field | Required | Description |
|-------|----------|-------------|
| `platform` | Yes | Must be `Mopar` |
| `name` | Yes | Name for the platform (e.g., "Mopar") |
| `email` | Yes | Your Mopar.com account email |
| `password` | Yes | Your Mopar.com account password |
| `pin` | Yes | **Required** 4-digit vehicle PIN for every remote command |
| `debug` | No | Enable verbose debug logging (default: `false`) |

## Supported Vehicles

### ✅ Confirmed Working
- **2022 Chrysler Pacifica** - Fully tested

### 🔄 Expected to Work (Needs Testing)
All Mopar vehicles with:
- Active Uconnect subscription with remote services
- Account registered at www.mopar.com
- Brands: Chrysler, Dodge, Jeep, Ram, Fiat, Alfa Romeo

**If you test this plugin with your vehicle, please [report your results](https://github.com/frankea/homebridge-mopar/issues/new)! Include:**
- Vehicle year, make, and model
- What features work/don't work
- Any error messages

## HomeKit Accessories

For each vehicle, the plugin creates:

### Controls
- **Lock/Unlock** - Lock mechanism to secure/unsecure your vehicle
- **Start Engine** - Switch to remote start your vehicle
- **Stop Engine** - Switch to remote stop your vehicle
- **Horn & Lights** - Momentary switch to activate horn and flash lights
- **Climate** - Switch to activate climate control (72°F)

### Sensors
- **Battery** - Battery level and charging status
- **Front Left Door** - Contact sensor
- **Front Right Door** - Contact sensor
- **Rear Left Door** - Contact sensor
- **Rear Right Door** - Contact sensor
- **Trunk** - Contact sensor

## Voice Control Examples

```
"Hey Siri, lock my car"
"Hey Siri, unlock my Pacifica"
"Hey Siri, start my Wrangler"
"Hey Siri, turn on my car climate"
"Hey Siri, is my trunk open?"
```

## How It Works

1. **Authentication:** Uses Puppeteer to automatically log into www.mopar.com and extract session cookies
2. **API Communication:** Makes authenticated requests to the Mopar API
3. **Command Execution:** Sends remote commands (lock, unlock, start, stop, etc.)
4. **Status Polling:** Polls command status until completion
5. **Proactive Session Refresh:** 
   - Refreshes session every 50 minutes (before 1-hour expiration)
   - Refreshes cookies every 20 hours (for long-term validity)
   - Commands always work immediately without waiting for re-authentication
6. **Smart Caching:** Caches vehicle data to ensure accessories load in ~5 seconds on startup

## Requirements

- Node.js >= 18.20.0
- Homebridge >= 1.8.0
- Chromium/Chrome (automatically installed with Puppeteer)
- Active Mopar.com account with remote services

## Troubleshooting

### Plugin Not Loading

- Verify your credentials work at www.mopar.com
- Check Homebridge logs for specific errors
- Ensure your vehicle has an active remote services subscription
- Enable debug logging in plugin settings for more detailed information

### Commands Not Working

- Verify your 4-digit PIN is configured in Homebridge (all remote commands are blocked without it)
- Check that remote commands work in the Mopar mobile app
- Look for error messages in Homebridge logs

### Puppeteer/Chromium Issues on Raspberry Pi

```bash
# Install required dependencies
sudo apt-get update
sudo apt-get install chromium-browser chromium-codecs-ffmpeg

# Set environment variable
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

### Multiple Commands Being Sent

This plugin includes 10-second debouncing on all commands to prevent HomeKit from sending duplicate commands.

### Empty Vehicle List

- Ensure your vehicle is properly registered at www.mopar.com
- Check that you can see your vehicle in the Mopar mobile app
- Verify your account has access to remote services

## Security & Privacy

- All credentials are stored locally in your Homebridge config
- All communication uses HTTPS
- No third-party servers or proxies are involved
- Authentication runs locally using Puppeteer
- Session cookies are managed automatically and stored in memory

## Support

- **Issues:** [GitHub Issues](https://github.com/frankea/homebridge-mopar/issues)
- **Testing Reports:** Please open an issue to report your vehicle compatibility results
- **Questions:** [Homebridge Discord](https://discord.gg/homebridge)

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues.

## License

MIT License - see LICENSE file for details

## Disclaimer

This plugin is not affiliated with, endorsed by, or connected to Stellantis, Chrysler, Dodge, Jeep, Ram, Fiat, Alfa Romeo, or Mopar. All trademarks belong to their respective owners.

## Credits

Created by Adam Franke
