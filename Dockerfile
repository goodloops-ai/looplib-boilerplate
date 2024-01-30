# Use the official Deno image from the Docker Hub
FROM denoland/deno

# Create a directory to hold the application code inside the image
WORKDIR /app

# Copy the local package files to the container's workspace
ADD . /app

RUN deno cache demo.mjs

# Run the Deno script
CMD ["run", "-A", "demo.mjs"]