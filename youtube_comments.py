import subprocess, json, csv

result = subprocess.run(
    ["yt-dlp", "--write-comments", "--skip-download", "-o", "%(id)s",
     "--dump-json", "https://www.youtube.com/watch?v=VIDEO_ID"],
    capture_output=True, text=True
)

data = json.loads(result.stdout)
comments = data.get("comments", [])

with open("comments.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=["author", "text", "like_count", "timestamp"])
    writer.writeheader()
    for c in comments:
        writer.writerow({
            "author": c.get("author"),
            "text": c.get("text"),
            "like_count": c.get("like_count"),
            "timestamp": c.get("timestamp")
        })
