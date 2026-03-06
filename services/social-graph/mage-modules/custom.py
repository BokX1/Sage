import json

import mgp


@mgp.transformation
def social_transform(messages: mgp.Messages) -> mgp.Record(
    query=str, parameters=mgp.Nullable[mgp.Map]
):
    results = []

    for i in range(messages.total_messages()):
        msg = json.loads(messages.message_at(i).payload().decode("utf-8"))

        event_type = msg.get("type")  # MENTION | REPLY | REACT
        guild_id = msg.get("guildId")
        source_id = msg.get("sourceUserId")
        target_id = msg.get("targetUserId")
        timestamp = msg.get("timestamp")
        sentiment = msg.get("sentimentScore", 0.0)
        channel_id = msg.get("channelId")
        if not guild_id or not source_id or not target_id or not channel_id:
            continue

        query = """
        MERGE (g:Guild {id: $guild_id})
        MERGE (a:User {id: $source_id})
        MERGE (b:User {id: $target_id})
        MERGE (c:Channel {id: $channel_id})
        SET c.guild_id = $guild_id
        MERGE (c)-[:IN_GUILD]->(g)
        MERGE (a)-[:ACTIVE_IN]->(c)
        MERGE (b)-[:ACTIVE_IN]->(c)
        MERGE (a)-[:ACTIVE_IN_GUILD]->(g)
        MERGE (b)-[:ACTIVE_IN_GUILD]->(g)
        CREATE (a)-[:INTERACTED {
            type: $event_type,
            ts: $timestamp,
            sentiment_score: $sentiment,
            guild_id: $guild_id
        }]->(b)
        """

        results.append(
            mgp.Record(
                query=query,
                parameters={
                    "guild_id": guild_id,
                    "source_id": source_id,
                    "target_id": target_id,
                    "channel_id": channel_id,
                    "event_type": event_type,
                    "timestamp": timestamp,
                    "sentiment": sentiment,
                },
            )
        )

    return results


@mgp.transformation
def voice_transform(messages: mgp.Messages) -> mgp.Record(
    query=str, parameters=mgp.Nullable[mgp.Map]
):
    results = []

    for i in range(messages.total_messages()):
        msg = json.loads(messages.message_at(i).payload().decode("utf-8"))

        guild_id = msg.get("guildId")
        user_a = msg.get("userA")
        user_b = msg.get("userB")
        timestamp = msg.get("timestamp")
        duration_ms = msg.get("durationMs", 0)
        if not guild_id or not user_a or not user_b:
            continue

        query = """
        MERGE (g:Guild {id: $guild_id})
        MERGE (a:User {id: $user_a})
        MERGE (b:User {id: $user_b})
        CREATE (a)-[:VOICE_SESSION {
            ts: $timestamp,
            duration_ms: $duration_ms,
            guild_id: $guild_id
        }]->(b)
        MERGE (a)-[:ACTIVE_IN_GUILD]->(g)
        MERGE (b)-[:ACTIVE_IN_GUILD]->(g)
        """

        results.append(
            mgp.Record(
                query=query,
                parameters={
                    "guild_id": guild_id,
                    "user_a": user_a,
                    "user_b": user_b,
                    "timestamp": timestamp,
                    "duration_ms": duration_ms,
                },
            )
        )

    return results
