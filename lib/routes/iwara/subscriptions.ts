import { getCurrentPath } from '@/utils/helpers';
const __dirname = getCurrentPath(import.meta.url);

import cache from '@/utils/cache';
import got from '@/utils/got';
import { config } from '@/config';
import { art } from '@/utils/render';
import { parseDate } from '@/utils/parse-date';
import * as path from 'node:path';
import MarkdownIt from 'markdown-it';
const md = MarkdownIt({
    html: true,
});

export default async (ctx) => {
    if (!config.iwara || !config.iwara.username || !config.iwara.password) {
        throw new Error('Iwara subscription RSS is disabled due to the lack of <a href="https://docs.rsshub.app/install/#pei-zhi-bu-fen-rss-mo-kuai-pei-zhi">relevant config</a>');
    }

    const rootUrl = `https://www.iwara.tv`;
    const username = config.iwara.username;
    const password = config.iwara.password;

    // get refresh token
    const refreshHeaders = await cache.tryGet(
        'iwara:token',
        async () => {
            const loginResponse = await got({
                method: 'post',
                url: 'https://api.iwara.tv/user/login',
                headers: {
                    'content-type': 'application/json',
                },
                data: JSON.stringify({
                    email: username,
                    password,
                }),
            });
            return {
                authorization: 'Bearer ' + loginResponse.data.token,
            };
        },
        30 * 24 * 60 * 60,
        false
    );

    // get subscription list
    const videoSubUrl = 'https://api.iwara.tv/videos?page=0&limit=30&subscribed=true';
    const imageSubUrl = 'https://api.iwara.tv/images?page=0&limit=30&subscribed=true';

    // get access token
    const accessResponse = await got({
        method: 'post',
        url: 'https://api.iwara.tv/user/token',
        headers: refreshHeaders,
    });

    const authHeaders = {
        authorization: 'Bearer ' + accessResponse.data.accessToken,
    };

    const videoResponse = await got({
        method: 'get',
        url: videoSubUrl,
        headers: authHeaders,
    });

    const imageResponse = await got({
        method: 'get',
        url: imageSubUrl,
        headers: authHeaders,
    });

    const videoList = videoResponse.data.results.map((item) => {
        const img_path = item.private === true ? 'https://i.iwara.tv/image/original/' : 'https://i.iwara.tv/image/thumbnail/';
        const imageUrl = item.file ? img_path + item.file.id.toString().padStart(2, '0') + '/thumbnail-' + item.thumbnail.toString().padStart(2, '0') + '.jpg' : '';

        return {
            title: item.title,
            author: item.user.name,
            link: rootUrl + '/video/' + item.id,
            category: 'Video',
            imageUrl,
            pubDate: parseDate(item.createdAt),
            private: item.private,
        };
    });

    const imageList = imageResponse.data.results.map((item) => {
        const imageUrl = item.thumbnail ? 'https://i.iwara.tv/image/thumbnail/' + item.thumbnail.id + '/' + item.thumbnail.id + '.jpg' : '';
        return {
            title: item.title,
            author: item.user.name,
            link: rootUrl + '/image/' + item.id,
            category: 'Image',
            imageUrl,
            pubDate: parseDate(item.createdAt),
        };
    });

    // fulltext
    const list = [...videoList, ...imageList];
    const items = await Promise.all(
        list.map((item) =>
            cache.tryGet(item.link, async () => {
                let description = art(path.join(__dirname, 'templates/subscriptions.art'), {
                    type: item.category,
                    imageUrl: item.imageUrl,
                });

                if (item.private === true) {
                    description += 'private';
                    return {
                        title: item.title,
                        author: item.author,
                        link: item.link,
                        category: item.category,
                        pubDate: item.pubDate,
                        description,
                    };
                }
                const link = item.link.replace('www.iwara.tv', 'api.iwara.tv');
                const response = await got({
                    method: 'get',
                    url: link,
                    headers: authHeaders,
                });
                const body = response.data.body ? md.render(response.data.body) : '';
                description += body;

                return {
                    title: item.title,
                    author: item.author,
                    link: item.link,
                    category: item.category,
                    pubDate: item.pubDate,
                    description,
                };
            })
        )
    );

    ctx.set('data', {
        title: `Iwara Subscription`,
        link: rootUrl,
        item: items,
    });
};
