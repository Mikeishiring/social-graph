# -*- coding: utf-8 -*-
import asyncio
import sys
import os

os.environ['SOCIAL_GRAPH_TWITTER_BEARER_TOKEN'] = 'new1_c2e35f5e8a13439f828b407fd9765184'
sys.path.insert(0, 'src')

from social_graph.twitter_client import TwitterClient

async def test():
    async with TwitterClient() as client:
        print('Testing API...', flush=True)

        # Test user info
        print('Getting user info...', flush=True)
        user = await client.get_user_by_username('mikeishiring')
        print(f'User: {user["username"]} (ID: {user["id"]})', flush=True)
        print(f'Followers: {user["public_metrics"]["followers_count"]}', flush=True)

        # Test followers pagination
        print('\nTesting followers pagination...', flush=True)
        page = 0
        async for users, cursor_in, cursor_out, truncated in client.paginate_followers(
            user["id"], username='mikeishiring', max_pages=1
        ):
            page += 1
            print(f'Page {page}: {len(users)} users', flush=True)
            if users:
                print(f'  First: @{users[0].get("username")}', flush=True)
                print(f'  Last: @{users[-1].get("username")}', flush=True)
            print(f'  Cursor out: {cursor_out[:30] if cursor_out else None}...', flush=True)

if __name__ == '__main__':
    asyncio.run(test())
