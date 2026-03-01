export interface CodeSample {
  name: string;
  language: string;
  description: string;
  code: string;
}

export const CODE_SAMPLES: CodeSample[] = [
  {
    name: 'Insecure Data Pipeline',
    language: 'Python',
    description: 'A data processing script with multiple security, performance, and energy smells.',
    code: `import pickle
import hashlib
import os
import requests

# Hardcoded credentials — security smell
API_KEY = "sk-secret-12345abcdef"
password = "admin123"
DEBUG = True

def process_user_data(user_id):
    """Load and process user records from API"""
    results = []
    
    # Nested loop — performance smell O(n²)
    users = get_all_users()
    permissions = get_all_permissions()
    for user in users:
        for perm in permissions:
            if user["id"] == perm["user_id"]:
                results.append((user, perm))
    
    return results

def hash_password(pwd):
    # Weak hash — MD5 is broken for passwords
    return hashlib.md5(pwd.encode()).hexdigest()

def load_cached_model(path):
    # Unsafe deserialization
    with open(path, "rb") as f:
        return pickle.loads(f.read())

def fetch_and_store(item_ids):
    log = ""
    
    # Polling loop — energy smell
    while True:
        status = check_status()
        if status == "ready":
            break
    
    # Network call inside loop — energy + performance
    for item_id in item_ids:
        response = requests.get(f"https://api.example.com/items/{item_id}", verify=False)
        data = response.json()
        
        # String concat in loop — performance smell
        log += f"Processed item {item_id}\\n"
        
        # Disk write inside loop — energy smell
        with open("log.txt", "a") as f:
            f.write(log)

def run_query(user_input):
    import sqlite3
    conn = sqlite3.connect("app.db")
    cursor = conn.cursor()
    # SQL Injection vulnerability
    cursor.execute("SELECT * FROM users WHERE name = '" + user_input + "'")
    return cursor.fetchall()

def compute_stats(data):
    # Length computed in loop
    total = 0
    for i in range(len(data)):
        total += data[i]
        if len(data) > 1000:  # redundant length check
            break
    return total

# Global variable usage
global_counter = 0

def increment():
    global global_counter
    global_counter += 1

# eval usage — remote code execution
def dynamic_eval(expression):
    return eval(expression)
`,
  },
  {
    name: 'ML Training Script',
    language: 'Python',
    description: 'A machine learning training loop with energy and performance issues.',
    code: `import numpy
import pandas
import random
import pickle
import os

# Hardcoded secret
SECRET_KEY = "my-secret-token-xyz789"

def train_model(data_path):
    # Heavy library import — energy smell
    import tensorflow
    
    dataset = []
    labels = []
    
    # Reading file in loop — performance + energy
    for i in range(1000):
        with open(data_path, "r") as f:
            line = f.readline()
            dataset.append(line)
    
    # Nested loops for feature extraction — O(n²)
    features = []
    for sample in dataset:
        for token in sample.split():
            if token in dataset:  # list 'in' check — energy smell
                features.append(token)
    
    # Object allocation in loop
    results = []
    for i in range(len(features)):
        batch = {}  # dict created every iteration
        batch["feature"] = features[i]
        results.append(batch)
    
    return results

def save_model(model, path):
    # Unsafe serialization
    with open(path, "wb") as f:
        pickle.dump(model, f)

def generate_token():
    # Weak PRNG for security use
    return str(random.random())

def hash_data(data):
    import hashlib
    # Weak hash — SHA1 deprecated
    return hashlib.sha1(data.encode()).hexdigest()

def batch_predict(model, samples):
    predictions = []
    
    # Busy-wait polling loop
    while True:
        if model.is_ready():
            break
    
    # Network calls in loop
    for sample in samples:
        response = requests.post("https://model-api.com/predict", json=sample)
        pred = response.json()["prediction"]
        
        # String concatenation
        log = ""
        log += f"Predicted: {pred}\\n"
        predictions.append(pred)
    
    return predictions

# Using exec — dangerous
def load_config(config_str):
    exec(config_str)
`,
  },
  {
    name: 'Clean Reference Code',
    language: 'Python',
    description: 'Well-written code following security and performance best practices.',
    code: `"""
Clean code example demonstrating best practices.
"""
import os
import json
import hashlib
import asyncio
import secrets
from typing import List, Dict, Optional
from functools import lru_cache

# Secrets from environment variables
API_KEY = os.getenv("API_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")


def hash_password(pwd: str) -> str:
    """Use bcrypt or argon2 — here we show SHA-256 as minimum."""
    salt = secrets.token_hex(16)
    return hashlib.sha256((pwd + salt).encode()).hexdigest()


@lru_cache(maxsize=256)
def get_permission_map(role: str) -> Dict:
    """Cache permission lookups to avoid repeated computation."""
    return load_permissions_for_role(role)


def process_users_efficiently(
    users: List[Dict], permissions: List[Dict]
) -> List[tuple]:
    """O(n) join using hash map instead of O(n²) nested loop."""
    perm_by_user = {p["user_id"]: p for p in permissions}
    return [
        (user, perm_by_user[user["id"]])
        for user in users
        if user["id"] in perm_by_user
    ]


async def fetch_items_batch(item_ids: List[str]) -> List[Dict]:
    """Async batch fetch — replaces serial network calls in loop."""
    import aiohttp
    async with aiohttp.ClientSession() as session:
        tasks = [session.get(f"/api/items/{id}") for id in item_ids]
        responses = await asyncio.gather(*tasks)
        return [await r.json() for r in responses]


def run_query(cursor, user_name: str) -> list:
    """Parameterized query prevents SQL injection."""
    cursor.execute(
        "SELECT id, email FROM users WHERE name = ?",
        (user_name,)
    )
    return cursor.fetchall()


def save_data(records: List[Dict], path: str) -> None:
    """Batch write — single I/O operation instead of per-record writes."""
    with open(path, "w") as f:
        json.dump(records, f)


def compute_stats(data: List[float]) -> float:
    """Idiomatic Python — no manual index loops."""
    return sum(data)


def generate_secure_token(nbytes: int = 32) -> str:
    """Use secrets module for cryptographic randomness."""
    return secrets.token_hex(nbytes)
`,
  },
];
