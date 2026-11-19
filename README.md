# TradeFXBook Trading Workspace

A full-stack starter project based on the 20 screenshots supplied in the conversation. It follows the dark, blue-accented desktop layout and includes a responsive sidebar/topbar workspace.

## Run locally
1. Install Node.js 20 or newer.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000`.
6. Create an account. Your trades and rules are stored in `trades.db`.

## Included in this first build
- Account registration and sign-in
- SQLite persistence for users, trades, and trading rules
- Dashboard metrics and equity curve
- Trade CRUD, CSV import/export, journal notes, checklist and screenshot uploads
- Performance statistics, calendar view, trade analysis
- Position sizing and risk/reward calculators
- Sanctuary focus timer
- TradingView chart embed and CSV close-price backtest prototype
- Profile/risk rule settings

## Important integration notes
- The TradingView iframe is a chart embed, not the licensed TradingView Charting Library and not a broker execution connection.
- Economic calendar live data, MT4/MT5 account sync, broker auto-sync, public community/leaderboard, hosted AI reports, and true tick-level replay need external providers, credentials, hosting and further implementation. They are not represented as connected in this starter.
- CSV backtest results are simplified close-to-close examples and exclude spread, slippage, commissions, and robust position sizing. Do not use as a basis for live trading decisions.
- Before public deployment, configure a strong `SESSION_SECRET`, HTTPS, secure cookies, upload storage limits, rate limiting, CSRF protection, backups, and production database/storage services.
