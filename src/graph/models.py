# Social Graph - Data models

from enum import Enum

class NodeType(Enum):
    PERSON = "person"
    TWEET = "tweet"
    COMPANY = "company"

class EdgeType(Enum):
    REPLIED_TO = "replied_to"
    MENTIONED = "mentioned"
    FOLLOWED = "followed"
    QUOTED = "quoted"
    POSTED = "posted"

class Person:
    def __init__(self, twitter_handle, display_name=None, followers=0, following=0):
        self.id = twitter_handle.lower()
        self.twitter_handle = twitter_handle
        self.display_name = display_name or twitter_handle
        self.followers = followers
        self.following = following
        self.first_seen = None
        self.last_interaction = None
    
    def to_dict(self):
        return {
            "type": NodeType.PERSON.value,
            "id": self.id,
            "twitter_handle": self.twitter_handle,
            "display_name": self.display_name,
            "followers": self.followers,
            "following": self.following,
            "first_seen": self.first_seen,
            "last_interaction": self.last_interaction
        }

class Tweet:
    def __init__(self, tweet_id, content, timestamp, tweet_type="post"):
        self.id = tweet_id
        self.content = content
        self.timestamp = timestamp
        self.type = tweet_type  # post, reply, mention
        self.url = f"https://twitter.com/i/web/status/{tweet_id}"
    
    def to_dict(self):
        return {
            "type": NodeType.TWEET.value,
            "id": self.id,
            "content": self.content,
            "timestamp": self.timestamp,
            "type": self.type,
            "url": self.url
        }

class Interaction:
    def __init__(self, source_node, target_node, edge_type, timestamp, tweet_id=None):
        self.source = source_node
        self.target = target_node
        self.type = edge_type
        self.timestamp = timestamp
        self.tweet_id = tweet_id
    
    def to_dict(self):
        return {
            "source": self.source,
            "target": self.target,
            "type": self.type.value if isinstance(self.type, EdgeType) else self.type,
            "timestamp": self.timestamp,
            "tweet_id": self.tweet_id
        }
