const { Events } = require('discord.js');
// Note: Links are intentionally NOT removed when a member leaves a server.
// This is because the bot uses a global link store — a user's link persists
// across all servers the bot is in. If you want to auto-unlink on leave,
// uncomment the body below.

module.exports = {
  name: Events.GuildMemberRemove,
  execute(member) {
    // const db = require('../modules/database');
    // const link = db.getLinkByDiscord(member.id);
    // if (link) {
    //   db.removeLink(member.id);
    //   db.audit({
    //     action: 'LINK_REMOVE_ON_LEAVE',
    //     targetDiscordId: member.id,
    //     targetRiotId: `${link.riot_name}#${link.riot_tag}`,
    //     guildId: member.guild.id,
    //   });
    // }
  },
};
