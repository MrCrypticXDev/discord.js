'use strict';

const { Collection } = require('@discordjs/collection');
const { ChannelTypes } = require('../util/Constants');
const Util = require('../util/Util');

/**
 * Keeps track of mentions in a {@link Message}.
 */
class MessageMentions {
  constructor(message, users, roles, everyone, crosspostedChannels, repliedUser) {
    /**
     * The client the message is from
     * @type {Client}
     * @readonly
     */
    Object.defineProperty(this, 'client', { value: message.client });

    /**
     * The guild the message is in
     * @type {?Guild}
     * @readonly
     */
    Object.defineProperty(this, 'guild', { value: message.guild });

    /**
     * The initial message content
     * @type {string}
     * @readonly
     * @private
     */
    Object.defineProperty(this, '_content', { value: message.content });

    /**
     * Whether `@everyone` or `@here` were mentioned
     * @type {boolean}
     */
    this.everyone = Boolean(everyone);

    if (users) {
      if (users instanceof Collection) {
        /**
         * Any users that were mentioned
         * <info>Order as received from the API, not as they appear in the message content</info>
         * @type {Collection<Snowflake, User>}
         */
        this.users = new Collection(users);
      } else {
        this.users = new Collection();
        for (const mention of users) {
          if (mention.member && message.guild) {
            message.guild.members._add(Object.assign(mention.member, { user: mention }));
          }
          const user = message.client.users._add(mention);
          this.users.set(user.id, user);
        }
      }
    } else {
      this.users = new Collection();
    }

    if (roles) {
      if (roles instanceof Collection) {
        /**
         * Any roles that were mentioned
         * <info>Order as received from the API, not as they appear in the message content</info>
         * @type {Collection<Snowflake, Role>}
         */
        this.roles = new Collection(roles);
      } else {
        this.roles = new Collection();
        const guild = message.guild;
        for (const mention of roles) {
          const role = guild.roles.cache.get(mention);
          if (role) this.roles.set(role.id, role);
        }
      }
    } else {
      this.roles = new Collection();
    }

    /**
     * Cached members for {@link MessageMentions#members}
     * @type {?Collection<Snowflake, GuildMember>}
     * @private
     */
    this._members = null;

    /**
     * Cached channels for {@link MessageMentions#channels}
     * @type {?Collection<Snowflake, Channel>}
     * @private
     */
    this._channels = null;

    /**
     * Crossposted channel data.
     * @typedef {Object} CrosspostedChannel
     * @property {Snowflake} channelId The mentioned channel's id
     * @property {Snowflake} guildId The id of the guild that has the channel
     * @property {ChannelType} type The channel's type
     * @property {string} name The channel's name
     */

    if (crosspostedChannels) {
      if (crosspostedChannels instanceof Collection) {
        /**
         * A collection of crossposted channels
         * <info>Order as received from the API, not as they appear in the message content</info>
         * @type {Collection<Snowflake, CrosspostedChannel>}
         */
        this.crosspostedChannels = new Collection(crosspostedChannels);
      } else {
        this.crosspostedChannels = new Collection();
        const channelTypes = Object.keys(ChannelTypes);
        for (const d of crosspostedChannels) {
          const type = channelTypes[d.type];
          this.crosspostedChannels.set(d.id, {
            channelId: d.id,
            guildId: d.guild_id,
            type: type ?? 'UNKNOWN',
            name: d.name,
          });
        }
      }
    } else {
      this.crosspostedChannels = new Collection();
    }

    /**
     * The author of the message that this message is a reply to
     * @type {?User}
     */
    this.repliedUser = repliedUser ? this.client.users._add(repliedUser) : null;
  }

  /**
   * Any members that were mentioned (only in {@link Guild}s)
   * <info>Order as received from the API, not as they appear in the message content</info>
   * @type {?Collection<Snowflake, GuildMember>}
   * @readonly
   */
  get members() {
    if (this._members) return this._members;
    if (!this.guild) return null;
    this._members = new Collection();
    this.users.forEach(user => {
      const member = this.guild.members.resolve(user);
      if (member) this._members.set(member.user.id, member);
    });
    return this._members;
  }

  /**
   * Any channels that were mentioned
   * <info>Order as they appear first in the message content</info>
   * @type {Collection<Snowflake, Channel>}
   * @readonly
   */
  get channels() {
    if (this._channels) return this._channels;
    this._channels = new Collection();
    let matches;
    while ((matches = this.constructor.CHANNELS_PATTERN.exec(this._content)) !== null) {
      const chan = this.client.channels.cache.get(matches[1]);
      if (chan) this._channels.set(chan.id, chan);
    }
    return this._channels;
  }

  /**
   * Options used to check for a mention.
   * @typedef {Object} MessageMentionsHasOptions
   * @property {boolean} [ignoreDirect=false] Whether to ignore direct mentions to the item
   * @property {boolean} [ignoreRoles=false] Whether to ignore role mentions to a guild member
   * @property {boolean} [ignoreEveryone=false] Whether to ignore everyone/here mentions
   */

  /**
   * Checks if a user, guild member, role, or channel is mentioned.
   * Takes into account user mentions, role mentions, and `@everyone`/`@here` mentions.
   * @param {UserResolvable|RoleResolvable|ChannelResolvable} data The User/Role/Channel to check for
   * @param {MessageMentionsHasOptions} [options] The options for the check
   * @returns {boolean}
   */
  has(data, { ignoreDirect = false, ignoreRoles = false, ignoreEveryone = false } = {}) {
    if (!ignoreEveryone && this.everyone) return true;
    const GuildMember = require('./GuildMember');
    if (!ignoreRoles && data instanceof GuildMember) {
      for (const role of this.roles.values()) if (data.roles.cache.has(role.id)) return true;
    }

    if (!ignoreDirect) {
      const id =
        this.guild?.roles.resolveId(data) ?? this.client.channels.resolveId(data) ?? this.client.users.resolveId(data);

      return typeof id === 'string' && (this.users.has(id) || this.channels.has(id) || this.roles.has(id));
    }

    return false;
  }

  toJSON() {
    return Util.flatten(this, {
      members: true,
      channels: true,
    });
  }
}

/**
 * Regular expression that globally matches `@everyone` and `@here`
 * @type {RegExp}
 */
MessageMentions.EVERYONE_PATTERN = /@(everyone|here)/g;

/**
 * Regular expression that globally matches user mentions like `<@81440962496172032>`
 * @type {RegExp}
 */
MessageMentions.USERS_PATTERN = /<@!?(\d{17,19})>/g;

/**
 * Regular expression that globally matches role mentions like `<@&297577916114403338>`
 * @type {RegExp}
 */
MessageMentions.ROLES_PATTERN = /<@&(\d{17,19})>/g;

/**
 * Regular expression that globally matches channel mentions like `<#222079895583457280>`
 * @type {RegExp}
 */
MessageMentions.CHANNELS_PATTERN = /<#(\d{17,19})>/g;

module.exports = MessageMentions;
