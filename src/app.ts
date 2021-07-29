require("dotenv").config()
import express, { Application, Router, Request, Response } from "express"
import fs from "fs"
import { connect, NatsConnectionOptions, Payload } from "ts-nats"
import _Docker from "dockerode"
import AdmZip from "adm-zip"
import { ScriptRunner } from "./helpers/ScriptRunner"
import { NotificationScheduling, cleanAllQueues, updateSchedule } from "./queue/ActivitySchedulerJob"
import { initializeQueues } from "./queue/Queue"
import { Mutex } from "async-mutex"
import ioredis from "ioredis"
import LAMP from "lamp-core"
const clientLock = new Mutex()
const app: Application = express()
const UploadPath = __dirname + "/uploads/"

const _server = app
export let RedisClient: ioredis.Redis | undefined

//LAMP-worker topics
const topics = ["activity_event", "activity", "participant", "researcher", "sensor_event", "sensor", "study"]
process.on('unhandledRejection', error => { console.dir(error) })
/**Initialize and configure the application.
 *
 */
async function main(): Promise<void> {
  try {
    if (typeof process.env.REDIS_HOST === "string") {
      await initializeQueues()
      RedisClient = new ioredis(
        parseInt(`${(process.env.REDIS_HOST as any).match(/([0-9]+)/g)?.[0]}`),
        process.env.REDIS_HOST.match(/\/\/([0-9a-zA-Z._]+)/g)?.[0]
      )
    }
    await ServerConnect()
    if (process.env.SCHEDULER === "on") {
      console.log("Clean all queues...")
      await cleanAllQueues()
      console.log("Initializing schedulers...")
      NotificationScheduling()
    } else {
      console.log("Running with schedulers disabled.")
    }
  } catch (error) {
    console.log("Encountered issue while starting LAMP-worker")
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

/**Get related tokens(eg: a.id1.b.aid1 will gives a.*.b.aid1,a.id1.b.*,a.*.b.* )
 *
 * @param token
 * @returns ARRAY related_tokens
 */
const getRelatedTokens = async (token: string): Promise<string[]> => {
  try {
    let related_tokens: string[] = []
    const arr = token.split(".")
    if (arr.length === 2) {
      related_tokens.push(arr[0] + ".*", token)
    } else if (arr.length === 4) {
      related_tokens.push(
        arr[0] + ".*" + "." + arr[2] + ".*",
        arr[0] + ".*." + arr[2] + "." + arr[3],
        arr[0] + "." + arr[1] + "." + arr[2] + ".*",
        token
      )
    }
    return related_tokens
  } catch (error) {
    console.log("token generation",error)
    return []
  }
}

/** extract the zip and run the script inside the container
 * @param array paths
 * @param string data
 */
const execScript = async (paths: string[], data?: any): Promise<void> => {
  for (const path of paths) {
    try {
      const realPath = UploadPath + path
      let zip = new AdmZip(realPath)
      let zipEntries = await zip.getEntries() // an array of ZipEntry records
      let extension
      let version = "" //to store version if any
      let script = "" //to store script
      let requirements = "" //to store requirements(or packages) if any

      for (const zipEntry of zipEntries) {
        try {
          if (zipEntry.entryName === "requirements.txt") {
            requirements = zipEntry.getData().toString("utf8")
          } else if (zipEntry.entryName === "version.txt") {
            version = zipEntry.getData().toString("utf8")
          } else {
            extension = zipEntry.entryName.split(".").pop()?.toLowerCase()
            script = zipEntry.getData().toString("utf8")
          }
        } catch (error) {
          console.log(error)
        }
      }

      let runner: ScriptRunner
      switch (extension) {
        case "js":
          runner = new ScriptRunner.JS()
          runner.execute(script, requirements, version, data)
          break

        case "py":
          runner = new ScriptRunner.PY()
          runner.execute(script, requirements, version, data)
          break

        default:
          break
      }
    } catch (error) {
      console.log(error)
    }
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
      }).then((x) =>
        topics.map((topic: any) => {
          console.log("topic published",topic)
          x.subscribe(topic, async (err, msg) => {
            const data = msg.data
            console.log("data published",data)
            updateSchedule(topic, data.data)
            if (!!process.env.DOCKER_IMAGE) {
              try {
                //create folder uploads if not exists
                 if (!fs.existsSync(UploadPath)) {
                    fs.mkdirSync(UploadPath, {
                     recursive: true,
                    })
                  }                
              } catch (error) {
                console.log("error while creating directory ",error)
              }
             
              const related_tokens = await getRelatedTokens(data.token)
              const researchers: any[] = await LAMP.Researcher.all()
              for (const researcher of researchers) {
                //fetch researchers from LAMP
                for (const related_token of related_tokens) {
                  const release = await clientLock.acquire()
                  try {
                    // const scriptpaths:any = await LAMP.Type.getAttachment("7s9ts30kq0w67tdg1qhe","study.cadn2efwhrxkppq9tn9t.activity.pqhm5zd2rbgpt5bjx5by")
                    const scriptpaths = (await LAMP.Type.getAttachment(
                      researcher.id,
                      `lamp.automation.${related_token}`
                    )) as any
                    if (!!scriptpaths.data) {
                      console.log(
                        "automation script found for researcherid",
                        `${researcher.id} against ${related_token}`
                      )
                      let buff = await Buffer.from(scriptpaths?.data, "base64")
                      const file_identifier = `${Math.floor(Math.random() * 10000)}_${new Date().getTime()}`
                      fs.writeFileSync(UploadPath + file_identifier + ".zip", buff)
                      const paths = file_identifier + ".zip"
                      console.log(
                        `Executing the script uploaded for the Researcher, ${researcher.id} for the token ${related_token} `
                      )
                      //execute the script retrieved for the token
                      await execScript(Array.isArray(paths) ? paths : [paths], JSON.stringify(data.data))
                      console.log("unlinking paths", `${__dirname}/uploads/${paths} `)
                      fs.unlinkSync(`${__dirname}/uploads/${paths}`)
                    }
                    release()
                  } catch (error) {
                    release()
                  }
                }
              }
            }
          })
        })
      )
      try {  
        //Starting the server
        _server.listen(process.env.PORT || 3000)
        console.log(`server listening in ${process.env.PORT}` )
      } catch (error) {
        console.log("error---while server listen",error)
      }
    } catch (error) {
      // tslint:disable-next-line:no-console
      console.log("error---while subscribing token",error)
    }
  })
  .catch(console.error)
