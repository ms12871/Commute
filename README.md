# My Commute Dashboard

A local dashboard for 1, 6, and F train arrival estimates. The MTA API key stays
on the Express server and is never sent to the browser.

## Setup

1. Install Node.js, then install the project dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and set your MTA API key:

   ```text
   MTA_API_KEY=your_actual_api_key
   ```

   Keep `.env` private; it is excluded by `.gitignore`.

3. Start the server and open <http://localhost:3000>:

   ```sh
   npm start
   ```

The dashboard compares live-predicted routes between Jamaica–179 St and Canal
St: F→1 versus F→6 in the morning, and 1→F versus 6→F in the evening. It picks
the option predicted to arrive first, shows an alternative when available, and
includes a five-minute transfer allowance. Estimates refresh every 30 seconds
and can vary with service conditions.
