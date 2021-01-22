FROM golang:1.14-alpine AS build

RUN apk add --no-cache git


WORKDIR /app/consumer

# We want to populate the module cache based on the go.{mod,sum} files.
COPY go.mod .
COPY go.sum .

RUN go mod download

COPY . .

RUN go build 

FROM alpine:latest
WORKDIR /home
# Copy the binary file from the first image
COPY --from=0 /app/consumer/consumer .
COPY --from=0 /app/consumer/sseevents.json .

EXPOSE 8090

# Run the binary program produced by `go install`
CMD ["./consumer" ]