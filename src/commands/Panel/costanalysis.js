const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");

module.exports = {
  name: "costanalysis",
  description: "Estimate the monthly cost based on the resources you want.",
  options: [
    {
      name: "cpu",
      description: "Number of vCores (min: 0.5)",
      type: ApplicationCommandOptionType.Number,
      required: true,
    },
    {
      name: "ram",
      description: "RAM in MB or GB (e.g., 512 for MB, 4 for GB)",
      type: ApplicationCommandOptionType.Number,
      required: true,
    },
    {
      name: "ramunit",
      description: "Unit of RAM (MB or GB)",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: [
        { name: "MB", value: "mb" },
        { name: "GB", value: "gb" },
      ],
    },
    {
      name: "disk",
      description: "Disk in MB or GB (e.g., 512 for MB, 5 for GB)",
      type: ApplicationCommandOptionType.Number,
      required: true,
    },
    {
      name: "diskunit",
      description: "Unit of Disk (MB or GB)",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: [
        { name: "MB", value: "mb" },
        { name: "GB", value: "gb" },
      ],
    },
  ],

  run: async ({ context }) => {
    let cpu = context.options.getNumber("cpu");
    let ram = context.options.getNumber("ram");
    let ramUnit = context.options.getString("ramunit");
    let disk = context.options.getNumber("disk");
    let diskUnit = context.options.getString("diskunit");
    const member = context.member;
    const maxCPU = 32;
    const maxRAMGB = 64;
    const maxDiskGB = 250;
    if (cpu < 0.5) cpu = 0.5;
    if (ramUnit === "mb" && ram < 512) ram = 512;
    if (ramUnit === "gb" && ram < 0.5) ram = 0.5;

    const ramInGB = ramUnit === "mb" ? ram / 1024 : ram;
    const diskInGB = diskUnit === "mb" ? disk / 1024 : disk;
      
    if (cpu > maxCPU || ramInGB > maxRAMGB || diskInGB > maxDiskGB) {
    return context.createMessage({
      content: `Hey, those specs are a bit over the top! Let's keep it practical and stay within the limits: CPU max ${maxCPU} vCores, RAM max ${maxRAMGB} GB, Disk max ${maxDiskGB} GB. Try adjusting to these, and we’re good to go!`,
      flags: 64,
    });
  }

    // Pricing
    const discountedCpuRate = 1.29;
    const regularCpuRate = 2.09;
    const ramRate = 0.55;
    const diskRate = 0.15;
    const allocationFee = 0.10;

    // CPU cost logic
    const discountedCores = Math.min(cpu, 2);
    const regularCores = Math.max(cpu - 2, 0);
    const cpuCost = (discountedCores * discountedCpuRate) + (regularCores * regularCpuRate);

    const ramCost = ramInGB * ramRate;
    const diskCost = diskInGB * diskRate;

    const rawTotal = cpuCost + ramCost + diskCost + allocationFee;

    // Round to nearest .99 and add +0.10
    let basePrice = rawTotal < 1 ? rawTotal : Math.floor(rawTotal) + 0.99 + 0.01;
    basePrice = parseFloat(basePrice.toFixed(2));

    // Role-based discount: flat £1 off
    let finalPrice = basePrice;
    let discountPercent = null;
    if (member?.roles?.cache?.has("1382653463904915569")) {
      finalPrice = parseFloat((basePrice - 1).toFixed(2));
      const percentDecrease = ((basePrice - finalPrice) / basePrice) * 100;
      discountPercent = percentDecrease.toFixed(1);
    }

    const embed = new EmbedBuilder()
      .setTitle("Resource Cost Analysis")
      .setColor("Blue")
      .addFields(
        {
          name: "CPU",
          value:
            `${discountedCores > 0 ? `${discountedCores} Core(s) × £${discountedCpuRate.toFixed(2)}` : ""}` +
            `${regularCores > 0 && discountedCores > 0 ? " + " : ""}` +
            `${regularCores > 0 ? `${regularCores} Core(s) × £${regularCpuRate.toFixed(2)}` : ""}` +
            ` = £${cpuCost.toFixed(2)}`
        },
        {
          name: "RAM",
          value: `${ram} ${ramUnit.toUpperCase()} = ${ramInGB.toFixed(2)} GB × £${ramRate} = £${ramCost.toFixed(2)}`,
        },
        {
          name: "Disk",
          value: `${disk} ${diskUnit.toUpperCase()} = ${diskInGB.toFixed(2)} GB × £${diskRate} = £${diskCost.toFixed(2)}`,
        },
        {
          name: "Server Allocation Fee",
          value: `£${allocationFee.toFixed(2)}`,
        },
        {
          name: "Estimated Monthly Cost",
          value: `£${basePrice.toFixed(2)}`,
        }
      );

    if (discountPercent !== null) {
      embed.addFields({
        name: "Discount Applied",
        value: `Final Cost: £${finalPrice.toFixed(2)} (${discountPercent}% discounted)`,
        inline: false,
      });
    }

    return context.createMessage({ embeds: [embed] });
  },
};
