module.exports = {
  TOKEN: "", // Discord bot token
  MongoDB: "", // MongoDB connection string

  adminid: "", // Discord user ID of the bot owner (Admin)
  ticketcategoryid: "", // Discord category ID for ticket channels
  ptero: {
    url: process.env.PTERODACTYL_URL || "", // Pterodactyl panel URL
    apiKey: process.env.PTERODACTYL_APP_API_KEY || "", // Pterodactyl API key ( Admin key )
    defaultLanguage: "en", // Do not change this
    clientApiKey: process.env.PTERODACTYL_CLIENT_API_KEY || "", // Pterodactyl client API key ( Admin key )
  }, 
};