module.exports = {
  name: "ping",
  description: "Check the bot's latency",

  run: async ({ client, context }) => {
    const apiLatency = Math.trunc(client.ws.ping);
    await context.createMessage({ content: `Ping - ${apiLatency}ms` });
  },
};
