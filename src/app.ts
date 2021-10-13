require("dotenv").config()
import express, { Application, Router, Request, Response } from "express"
import { connect, NatsConnectionOptions, Payload } from "ts-nats"
import _Docker from "dockerode"
import { NotificationScheduling, cleanAllQueues, UpdateSchedule } from "./queue/ActivitySchedulerJob"
import { StoreAutomations, TriggerAutomations, LocateAutomation } from "./queue/Automation"
import { initializeQueues } from "./queue/Queue"
import LAMP from "lamp-core"
const app: Application = express()
const _server = app

//LAMP-worker nats listeners
const topics = [
  "activity_event",
  "lamp.automation",
  "activity",
  "participant",
  "researcher",
  "sensor_event",
  "sensor",
  "study",
]
process.on("unhandledRejection", (error) => {
  console.dir(error)
})

//LAMP-worker triggers for automation script
export let triggers = {
  "researcher.*": new Array(),
  "researcher.*.study.*": new Array(),
  "study.*.participant.*": new Array(),
  "study.*.activity.*": new Array(),
  "study.*.sensor.*": new Array(),
  "activity.*.participant.*": new Array(),
  "sensor.*.participant.*": new Array()
} as any

/**Initialize and configure the application.
 *
 */
async function main(): Promise<void> {
  try {
    if (typeof process.env.REDIS_HOST === "string") {    
      await initializeQueues()
    }
    console.log("Initialized the queues")
    await ServerConnect()
    if (process.env.SCHEDULER === "on") {
      console.log("Clean all queues...")
      await cleanAllQueues()
      console.log("Initializing schedulers...")
      NotificationScheduling()
    } else {
      console.log("Running with schedulers disabled.")
    }
    if (!!process.env.AUTOMATION && process.env.AUTOMATION === "on") {
      console.log("Locating automations...")
      const researchers = (await LAMP.Researcher.all()) as any
      for (let researcher of researchers) {
        LocateAutomation(researcher.id)
      }
    } else {
      console.log("Running with automation disabled.")
    }
    //Starting the server
    _server.listen(process.env.PORT || 3000)
    console.log(`server listening in ${process.env.PORT}`)
  } catch (error) {
    console.log("Encountered issue while starting LAMP-worker", error)
  }
}

/**
 * Initializing LAMP_SERVER connection
 */
async function ServerConnect(): Promise<void> {
  try {
    const server_url = `${process.env.LAMP_SERVER}`
    const accessKey = process.env.LAMP_AUTH?.split(":")[0] as string
    const secretKey = process.env.LAMP_AUTH?.split(":")[1] as string
    await LAMP.connect({ accessKey: accessKey, secretKey: secretKey, serverAddress: server_url })
  } catch (error) {
    throw new error("Lamp server connection failed ")
  }
}

main()
  .then((x: any) => {
    //Initiate Nats server
    console.log("Initiating nats server")
    try {
      connect({
        servers: [`${process.env.NATS_SERVER}`],
        payload: Payload.JSON,
      })
        .then((x) => {
          topics.map((topic: any) => {
            x.subscribe(topic, async (err, msg) => {
              const data = msg.data
              //update schedule if needed
              UpdateSchedule(topic, data.data)              
              if (!!process.env.AUTOMATION && process.env.AUTOMATION === "on") {
                //store automations if needed
                StoreAutomations(topic, data.data)
                //invoke automation script if needed
                TriggerAutomations(data.token, data.data)
              }
            })
          })
        })
        .catch((error) => {
          console.log("error---while nats connect", error)
        })
    } catch (error) {
      // tslint:disable-next-line:no-console
      console.log("error---while subscribing token", error)
    }
  })
  .catch(console.error)
