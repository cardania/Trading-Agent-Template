# Talos - Autonomous Cardano DEX Trading Bot

An AI-powered trading bot that uses TapTools data and GPT-4 analysis to execute trades across Cardano DEXs using [Indigo Labs' Dexter SDK](https://github.com/IndigoProtocol/dexter).

## Features

- 🤖 GPT-4 Trading Analysis
  - Price and volume pattern recognition
  - Market structure analysis
  - Confidence-based trade execution
  - Detailed reasoning for each decision

- 📊 TapTools Data Integration
  - Top volume token tracking
  - Price and volume metrics
  - Trading statistics and pools data
  - OHLCV historical data

- 💼 Category-Based Portfolio Management
  - Supports multiple token categories:
    - ADA
    - Meme Coins
    - Shards/Talos
    - INDY
    - Major Projects
    - New Positions
  - Target ratio enforcement
  - Balance checks and position sizing

- 🔄 Dexter & Iris Integration
  - Automated pool discovery
  - Slippage protection
  - Transaction verification
  - Error handling

## Prerequisites

- Node.js v18+
- NPM or Yarn
- TapTools API Key
- OpenAI API Key (GPT-4 access)
- Blockfrost Project ID
- Cardano Wallet Seed Phrase

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/talos-dexter-bot.git

# Install dependencies
cd talos-dexter-bot
npm install

# Copy example config files
cp src/config/prompts.template.ts src/config/prompts.ts
cp src/config/analysis-guidelines.template.ts src/config/analysis-guidelines.ts
```

## Configuration

1. Create a `.env` file:
```env
TAP_TOOLS_API_KEY=your_taptools_key
OPENAI_API_KEY=your_openai_key
BLOCKFROST_PROJECT_ID=your_blockfrost_id
SEED_PHRASE="your seed phrase"
CARDANO_ADDRESS=your_cardano_address
```

2. Customize the AI agent's behavior in `src/config/prompts.ts`
3. Adjust analysis parameters in `src/config/analysis-guidelines.ts`
4. Modify portfolio ratios in `portfolio-swaps.ts` if needed

## Usage

```bash
# Build the project
npm run build

# Start the bot
npm run start

# Start with logging
npm run start-logs
```

## Architecture

```
src/
├── config/                  # Configuration files
│   ├── prompts.ts          # AI agent personality & prompts
│   └── analysis-guidelines.ts  # Trading analysis rules
├── portfolio-swaps.ts      # Main bot logic
└── types/                  # TypeScript type definitions
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Warning

This bot is experimental software. Use at your own risk. Never trade with funds you cannot afford to lose.

## Customization

- Adjust target ratios in portfolio management
- Modify trading thresholds and confidence levels
- Add new token categories
- Implement additional technical analysis
- Customize the AI agent's personality

## License

MIT License

Copyright (c) 2024 Flux Point Studios, Inc. (http://www.fluxpointstudios.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Acknowledgments

- [Indigo Protocol](https://indigoprotocol.io/) & Zachary Sluder for the Dexter and Iris SDKs
- TapTools for market data API
- OpenAI for GPT-4o API
# Trading-Agent-Template
