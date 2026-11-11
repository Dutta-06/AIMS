import uvicorn

if __name__ == "__main__":
    # Localhost only: the app has no login, so it must not be reachable from the network.
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
