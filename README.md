# Pterodactyl Discord Manager

A Discord bot for managing user registration, server creation, and administration for a [Pterodactyl](https://pterodactyl.io/) panel. Users can register via email OTP, create servers, and manage their panel accounts directly from Discord.

## Features

- **User Registration:** Register with email verification and OTP.
- **Server Creation:** Create servers with resource tiers (Free/Premium) and select from Node.js, Python, or Java eggs.
- **Account Management:** Login, delete account, and view slot usage.
- **Admin Tools:** Delete all servers, modify server resources, delete ticket channels, and more.
- **Role Sync:** Automatically assign roles based on server ownership.
- **Slot Announcements:** Notifies users when server slots are available.
- **Cost Analysis:** Estimate monthly costs for custom server specs.

## Commands

- `/register <email>` – Register a new panel account.
- `/login` – Get your panel login details.
- `/create <egg> <servername>` – Create a new server.
- `/delete <serverid>` – Delete one of your servers.
- `/deleteaccount` – Delete your panel account and all servers.
- `/slots` – Show current usage vs. max slots for each tier.
- `/costanalysis` – Estimate monthly cost for custom resources.
- `/deletetickets` – (Admin) Delete all ticket channels in the specified category.
- `/deleteall` – (Admin) Delete all servers except whitelisted ones.
- `/modify` – (Admin) Modify resources for all non-premium, non-whitelisted servers.
- `/ping` – Check bot latency.

## Setup

### Prerequisites

- Node.js v18+
- MongoDB database
- A Pterodactyl panel with API access
- A Discord bot token

### Installation

1. **Clone the repository:**
   ```sh
   git clone <your-repo-url>
   cd Pterodactyl-Discord-Manager
   ```

2. **Install dependencies:**
   ```sh
   npm install
   ```

3. **Configure settings:**
   - Copy `settings.js` and fill in your credentials:
     - Discord bot token
     - MongoDB connection string
     - Admin Discord user ID
     - Ticket category ID
     - Pterodactyl panel URL and API keys

4. **Configure SMTP for email verification:**
   - Edit [`src/structures/sendVerificationEmail.js`](src/structures/sendVerificationEmail.js) and set your SMTP credentials.

5. **Start the bot:**
   ```sh
   npm start
   ```

## File Structure

- [`src/commands/`](src/commands/) – All bot commands (Panel and Misc).
- [`src/events/`](src/events/) – Discord event handlers.
- [`src/models/`](src/models/) – Mongoose models for users.
- [`src/structures/`](src/structures/) – Utility classes and API wrappers.
- [`settings.js`](settings.js) – Main configuration file.

## Notes

- Only the admin (set in `settings.js`) can use destructive commands like `/deletetickets`, `/deleteall`, and `/modify`.