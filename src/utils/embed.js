const { EmbedBuilder } = require('discord.js');
const config = require('../../config');

const FOOTER = { text: 'VALORANT OCE Utilities', iconURL: null };

function base(color) {
  return new EmbedBuilder().setColor(color).setFooter(FOOTER).setTimestamp();
}

module.exports = {
  success(title, description) {
    return base(config.colors.success).setTitle(`✅ ${title}`).setDescription(description);
  },
  error(title, description) {
    return base(config.colors.error).setTitle(`❌ ${title}`).setDescription(description);
  },
  warning(title, description) {
    return base(config.colors.warning).setTitle(`⚠️ ${title}`).setDescription(description);
  },
  info(title, description) {
    return base(config.colors.info).setTitle(`ℹ️ ${title}`).setDescription(description);
  },
  primary(title, description) {
    return base(config.colors.primary).setTitle(title).setDescription(description);
  },
};
