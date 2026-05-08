---
title: AWS Free Tier — Hackathon Participant Guide
source: Notion (file.notion.so)
type: hackathon participant guide
---

# AWS Free Tier — Hackathon Participant Guide

This guide will get you onto AWS for free for the hackathon. Read the whole thing once before signing up, there are a few non-obvious traps that can rack up real charges.

---

## TL;DR (read this even if you skip the rest)

1. **Create a brand-new AWS account.** If you've ever had one before, you're not eligible for the free plan.
2. **At signup, choose the "Free plan."** You get $100 in credits immediately, plus up to $100 more for completing onboarding tasks. Valid for 6 months.
3. **Set a billing alert at $1 before you build anything.** This is the single most important step.
4. **Stick to "Always Free" AWS services** (Lambda, S3, API Gateway, CloudWatch), they don't draw down your credits and they reset monthly forever.
5. **For your database, use the MongoDB Atlas M10 sandbox cluster** that organizers will provide, *not* AWS DocumentDB. See Step 4.
6. **Avoid NAT Gateways, Elastic IPs, large EC2 instances, DocumentDB, and orphaned volumes.** These are the most common surprise-bill sources.
7. **Tear everything down when the hackathon ends.**

---

## Step 1: Create Your AWS Account

Go to [aws.amazon.com/free](https://aws.amazon.com/free) and click **Create an AWS Account**.

A few things to know:

- **You must use an email that has never been used for AWS before.** Free tier eligibility is per-email and per-phone-number. If you have an old account, sign up with a fresh email.
- **A credit/debit card is required.** AWS won't charge it as long as you stay within free limits, but they need it on file. You'll be charged $1 as a verification (refunded).
- **Choose region carefully.** During signup AWS picks a default region based on your location, but you can pick anything. Use `us-east-1` (N. Virginia), it has the broadest free tier coverage and the cheapest paid pricing if you accidentally exceed it.

When you reach the plan selection screen:

- **Choose Free plan**, not Paid plan.
- The Free plan gives you the credits and prevents your account from being charged beyond them, if you exhaust credits, your account closes rather than billing your card.
- The Paid plan also gives you the credits but will start charging your card the moment you exceed them.

> ⚠️ **Do not** join an AWS Organization or AWS Control Tower with this account. Doing so immediately voids your free tier credits and converts you to a paid plan. This matters if you're tempted to add the hackathon account to your company's corporate AWS setup, don't.

---

## Step 2: Set Billing Alerts (DO THIS BEFORE BUILDING ANYTHING)

The #1 cause of "I got a $400 bill from AWS" stories is missing billing alerts. Set them up immediately.

1. Sign in to the AWS Console.
2. Go to **Billing and Cost Management → Budgets → Create budget**.
3. Choose **Use a template (simplified) → Zero spend budget**.
4. Name it `hackathon-zero-spend`, add your email, and create it.
5. Go to **Billing Preferences** and turn on **Free Tier usage alerts** (sends email when you hit 85% of any free tier limit).

This will email you the moment a single dollar hits your account beyond credits. If you get one of these emails during the hackathon, stop what you're doing and figure out what's running.

---

## Step 3: Use the Right Services

There are three categories of free on AWS, and conflating them is what burns people.

### ✅ Always Free (use these by default)

These services have monthly free allowances that **reset every month and never expire**, regardless of credits or account age. For a hackathon project, these can usually carry your entire backend.

| Service | Monthly Free Limit | Good for |
| --- | --- | --- |
| **AWS Lambda** | 1M requests + 400K GB-seconds compute | Serverless backend, API endpoints, event handlers |
| **S3** | 5 GB standard storage, 20K GET, 2K PUT requests | File storage, static site hosting, model artifacts |
| **API Gateway** | 1M REST API calls (first 12 months) | Routing requests to Lambda |
| **CloudWatch** | 10 metrics, 10 alarms, 1M API requests | Logging and monitoring |
| **SNS** | 1M publishes | Push notifications, fan-out |
| **SQS** | 1M requests | Message queues |
| **Cognito** | 50,000 MAUs | User auth |
| **Step Functions** | 4,000 state transitions | Workflow orchestration |
| **EventBridge** | 14M events from AWS sources | Cron jobs, event routing |

A serverless app built on Lambda + API Gateway + S3 + Cognito (with MongoDB Atlas as the database, see the section below) will cost you essentially $0 during the hackathon.

### 🟡 Credit-Funded (uses your $100–$200 credits)

EC2, RDS, ECS, Bedrock, SageMaker, ElastiCache, etc. These all draw from your credit balance. Workable for a hackathon, but watch usage.

A few rough costs to calibrate:

- `t3.micro` EC2 instance: ~$0.01/hour (~$7/month if always on)
- `db.t3.micro` RDS instance: ~$0.017/hour
- Bedrock: per-token pricing, varies wildly by model, Claude Haiku is cheap, Claude Opus and large image models are not
- SageMaker training: can burn $50+ in an afternoon if you pick a GPU instance

### 🔴 Trial-only (limited time then full price)

Some services give you a one-time trial window (e.g., Aurora Serverless, certain ML services). Read the fine print before clicking the "start free trial" buttons in the console, once the clock starts, it doesn't stop.

---

## Step 4: Connect to Your MongoDB Atlas Cluster

This is a MongoDB hackathon, so your database lives in **MongoDB Atlas**, not in AWS. Atlas is MongoDB's managed cloud service that runs *on top of* AWS.

**Good news:** MongoDB is providing each team with an **M10 sandbox cluster on AWS**, so you don't need to set up Atlas yourself. The organizers will give you connection details before the hackathon starts. M10 includes the full feature set, Atlas Search, Vector Search, Triggers, the works.

### Why not AWS DocumentDB?

AWS has a service called **DocumentDB** that's MongoDB API-compatible. **Don't use it.** It has no free tier, the smallest instance is ~$0.08/hour (~$60/month), it requires VPC setup, and it doesn't support the latest MongoDB features. You already have a much better cluster waiting for you in Atlas, use that.

### Connect from AWS Lambda

You'll receive a connection string from the organizers that looks like:

```
mongodb+srv://<user>:<password>@<cluster-name>.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

Store it in **AWS Systems Manager Parameter Store** (free tier) or as a Lambda environment variable. **Don't hardcode it** and don't commit it to git.

```python
# Example Lambda handler (Python)
import os
from pymongo import MongoClient

# Initialize OUTSIDE the handler so it's reused across invocations
client = MongoClient(os.environ['MONGODB_URI'])
db = client['hackathon']

def handler(event, context):
    db.users.insert_one({"name": "test"})
    return {"statusCode": 200}
```

For Node.js Lambda, use the official `mongodb` driver and follow the same pattern. **Important:** Initialize the MongoDB client *outside* the handler, if you put it inside, you'll create a new connection on every invocation and exhaust the connection pool fast.

### Tips for working with the M10 sandbox

- **Same region matters.** When you choose your AWS region for Lambda/EC2, match it to the region your Atlas cluster is in (the organizers will tell you which one). Same-region traffic avoids cross-region data transfer charges on the AWS side and keeps latency low.
- **Vector Search is available**, if you're building anything RAG-flavored, this is probably the marquee feature MongoDB wants you to use. Index docs at `db.collection.createSearchIndex(...)`.
- **Connection limits are generous on M10** (~1,500) but Lambda concurrency can still blow through them. Use connection pooling and reuse clients across invocations.
- **The cluster is shared with your team, not other teams.** Don't put anything you don't want your teammates to see in there, but it is isolated from other hackathon participants.

---

## Step 5: Avoid the Landmines

These will charge you regardless of free tier status. Memorize this list.

- **NAT Gateway** — $0.045/hour just for existing (~$33/month) plus data charges. **Never create one for a hackathon project.** If you need internet access from a private subnet, just put your resources in a public subnet during dev.
- **Elastic IPs (EIPs)** — Free while attached to a running instance, but **charged hourly when unattached**. If you stop or terminate an EC2 instance, release any EIPs you allocated.
- **DocumentDB** — AWS's MongoDB-compatible service. Looks tempting because it's "right there in AWS," but no free tier and ~$60/month minimum. Use Atlas instead (see Step 4).
- **EBS volumes after instance termination** — Some launch configs leave the volume behind when you terminate the instance. Check your EBS volumes after cleanup.
- **CloudWatch Logs ingestion** — $0.50/GB. If your Lambda logs `console.log` on every request, this adds up fast. Set log retention to 1 day during the hackathon.
- **Data transfer out** — 100 GB/month is free across all services, but heavy API usage or large model outputs can exceed this.
- **Oversized EC2 instances** — Free tier covers `t2.micro` / `t3.micro` only. Anything bigger costs real money. Double-check the instance type before launching.
- **Multiple regions** — You might "test in eu-west-1" and forget you left something running there. Stick to one region for the entire event.

---

## Step 6: Recommended Hackathon Stacks

If you want to stay 100% within free limits (AWS + Atlas M0), here are battle-tested combos:

### Web app / API project:

- Frontend: S3 + CloudFront (static hosting)
- Backend: API Gateway → Lambda
- Database: MongoDB Atlas M0
- Auth: Cognito (or Atlas App Services / Auth0 if you prefer)
- Cost: $0

### AI agent / LLM project:

- Compute: Lambda (or EC2 `t3.micro` if you need a long-running process)
- Model inference: Bedrock with Claude Haiku, or call out to OpenAI/Anthropic API directly (often cheaper than Bedrock)
- Vector store: **MongoDB Atlas Vector Search**, included with your provided M10 sandbox cluster. This is the headline feature MongoDB wants you to use for RAG, semantic search, and agent memory.
- Document/chat history: MongoDB Atlas
- Cost: a few dollars of inference at most

### Data pipeline project:

- Ingest: S3 → Lambda triggers
- Process: Lambda or Step Functions
- Store: MongoDB Atlas (for structured data) + S3 (for raw files)
- Cost: $0

**What to avoid for hackathons:** Kubernetes (EKS has a $0.10/hour control plane fee), RDS or DocumentDB (use Atlas instead), anything with "Enterprise" in the name, EC2 instances larger than `t3.micro`.

---

## Step 7: Clean Up After the Hackathon

When the event ends, do this same day:

1. **Terminate all EC2 instances** (Console → EC2 → Instances → Terminate).
2. **Delete all EBS volumes** that aren't attached to anything.
3. **Release all Elastic IPs.**
4. **Delete S3 buckets** (or at least empty them, storage charges accrue silently).
5. **Delete RDS / Aurora databases** if you spun any up.
6. **Check every region you touched**, go to the EC2 console and use the region dropdown in the top right.
7. **Atlas:** the M10 sandbox is provided by MongoDB, they'll handle teardown. You don't need to do anything.
8. **If you're done with AWS entirely**, close the account from **Account Settings**. AWS holds your data for 90 days before deletion.

---

## Common Questions

**"Will AWS charge my card if I exceed limits?"** On the Free plan: no. Your account closes instead. On the Paid plan: yes, immediately.

**"Can I use my company's AWS account?"** Technically yes, but you won't get free tier benefits and your usage will hit the company bill. Use a personal account.

**"What if I already have an AWS account from years ago?"** You're not eligible for the new free plan or the $200 in credits. Your options: (a) sign up with a different email and phone number on a new account, (b) use your existing account and rely only on Always Free services to stay at $0.

**"Is the credit card actually required?"** Yes. There's no way around it, even free signup requires a valid card. AWS doesn't accept prepaid debit cards from many issuers.

**"What if I get a surprise bill?"** Email AWS Support immediately and explain it was a hackathon project / accidental usage. They'll often waive first-time charges, especially small ones, but this isn't guaranteed.

---

## Get Help During the Hackathon

- AWS docs: [docs.aws.amazon.com](https://docs.aws.amazon.com)
- Free tier overview: [aws.amazon.com/free](https://aws.amazon.com/free)
- Pricing calculator (use before launching anything paid): [calculator.aws](https://calculator.aws)
- Check your current spend anytime: Console → Billing → Cost Explorer
