/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Twitter from 'twitter';
import config from './config';
import Wallet from './wallet';
import hathorLib from '@hathor/wallet-lib';


class Manager {
  constructor(config) {
    this.onWalletStateChange = this.onWalletStateChange.bind(this);
    this.onNewTx = this.onNewTx.bind(this);
    this.onNewTweet = this.onNewTweet.bind(this);

    this.wallet = new Wallet(config);
    this.wallet.on('state', this.onWalletStateChange);
    this.wallet.on('new-tx', this.onNewTx);

    this.twitter = new Twitter(config);

    this.tokens = {
      'FGVT': {
        'name': 'FGV Token',
        'symbol': 'FGVT',
        'uid': 'c83d20ab7bf1751759a99cdb55ef2802f94fd1339f4c796b4981664a68c17528'
      }
    };
  }

  onWalletStateChange(state) {
    if (state === Wallet.CLOSED) {
      console.log('Wallet is disconnected.');

    } else if (state === Wallet.CONNECTING) {
      console.log('Wallet is connecting...');

    } else if (state === Wallet.SYNCING) {
      console.log('Wallet is connected and syncing...');

    } else if (state === Wallet.READY) {
      console.log('Wallet is ready!');
      console.log('Current address:', this.wallet.getCurrentAddress());
      this.startTwitter();

    } else {
      console.log('Wallet unknown state:', state);
    }
  }

  onNewTx(tx) {
    //console.log('onNewTx', tx);
  }

  matchAddresses(text) {
    return text.match(/\bW[a-zA-Z0-9]{33}\b/g) || [];
  }

  matchHashtags(text) {
    return text.match(/\B#\w*[a-zA-Z]+\w*\b/g);
  }

  matchMentions(text) {
    return text.match(/\B@\w*[a-zA-Z]+\w*\b/g);
  }

  likeTweet(tweet) {
    this.twitter.post('favorites/create', { id: tweet.id_str }, function(err, response) {
      if (err) {
        console.log('likeTweet error:', err[0].message);
        return;
      }

      let username = response.user.screen_name;
      let tweetId = response.id_str;
      console.log(`Tweet liked: https://twitter.com/${username}/status/${tweetId}`)
    });
  }

  onNewTweet(tweet) {
    console.log(`New tweet found: ${tweet.text}`);

    if (this.wallet.state !== Wallet.READY) {
      console.log('Wallet is not ready. Skipping tweet...');
      return;
    }

    const result = this.parseTweet(tweet);
    if (!result) {
      return;
    }

    const username = tweet.user.screen_name;

    this.likeTweet(tweet);
    this.wallet.sendMultiTokenTransaction(result).then((response) => {
      const { address, value, token } = result[0];
      if (response.success) {
        const tx = response.tx;
        const value_str = `${value / 100} ${token.symbol}`;
        const url = `https://explorer.hathor.network/transaction/${tx.hash}`;
        const replyMessage = `@${username} I just sent ${value_str} to ${address}. Enjoy our testnet!\n\n${url}`;
        this.replyTweet(tweet, replyMessage);

      } else {
        console.log('Error:', response);
      }

    }).catch((error) => {
      console.log('Error sending tokens:', error);
      const replyMessage = "@${username} I'm out of balance now. Sorry. :'(";
      //const replyMessage = "Something went wrong sending you tokens. Sorry. :'("
      this.replyTweet(tweet, replyMessage);
    });
  }

  replyTweet(tweet, message) {
    const data = {
      in_reply_to_status_id: tweet.id_str,
      status: message,
    };
    this.twitter.post('statuses/update', data, function(err, response) {
      if (err) {
        console.log('replyTweet error:', err[0].message);
        return;
      }

      let username = response.user.screen_name;
      let tweetId = response.id_str;
      console.log(`Tweet replied: https://twitter.com/${username}/status/${tweetId}`)
    });
  }

  parseTweet(tweet) {
    const addresses = this.matchAddresses(tweet.text);
    if (addresses.length === 0) {
      console.log('No address found. Skipping tweet...');
      return null;
    }
    if (addresses.length > 1) {
      console.log('Too many addresses. Skipping tweet...');
      return null;
    }

    // Exactly one address found. Great!
    // Let's look for the hashtags.

    const hashtags = this.matchHashtags(tweet.text);
    if (hashtags.findIndex((x) => x.toLowerCase() === '#fgv2019') >= 0) {
      console.log('FGV and HTR')
      // Send FGV token and HTR
      const address = addresses[0];
      const value = 300;
      const token = this.tokens.FGVT;

      const valueHTR = 100;
      const tokenHTR = Wallet.HTR_TOKEN;
      return [{address, value, token}, {address, valueHTR, tokenHTR}];
    }
    if (hashtags.findIndex((x) => x.toLowerCase() === '#iwanthtr') >= 0) {
      console.log('HTR')
      const address = addresses[0];
      const value = 100;
      const token = Wallet.HTR_TOKEN;
      return [{address, value, token}];
    }

    console.log(`Missing hashtag. Skipping tweet...`);
    return null;
  }

  start() {
    this.wallet.start();
  }

  startTwitter() {
    this.twitter.stream('statuses/filter', {track:'@HathorNetwork'}, (stream) => {
      console.log('Twitter ready!');
      stream.on('data', this.onNewTweet);
      stream.on('error', (error) => {
        throw error;
      });
    });
  }
}

const manager = new Manager(config);
manager.start();
