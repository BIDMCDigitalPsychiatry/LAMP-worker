package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/r3labs/sse/v2"
)

const RUNJS  = "node"
const RUNPY = "python3"
const SSEEVENTSFILE = "sseevents.json"

//ArgData ... argument data and the path to the script files
type ArgData struct {
	Token string `json:"token"`
	Data string	`json:"data"`
}

//load all the listenrs to the SSE server. The paths are defined in the sseevents.json
func loadSSEEventListeners()error{

	ef,err := os.Open(SSEEVENTSFILE)

	//if we cannot open the events file there is no point of moving ahead
	if err !=nil{
		return err
	}
	//new json decoder
	d := json.NewDecoder(ef)
	events := &struct{
		SSEEvents []string
	}{}
	err = d.Decode(events)
	if err !=nil{
		return err
	}
	log.Println("loading SSE clients....")
	//now start the SSE clients based on the events in the events array
	for _,e := range events.SSEEvents{
		url := baseURL + "/listen" +e
		sscl := NewSSeClient(url)
		//run each client in a seperate go routine
		go subscribe(sscl)
	}
	return nil
}

//SSEClient an SSEClient object
type SSEClient struct{

	//SSE client object
	client *sse.Client

}

//subscribe to listen to the server 
func subscribe(s *SSEClient){

	log.Println("Subscribing:",s.client.URL)
	err := s.client.SubscribeRaw(func(msg *sse.Event){
		//got some data
		rawIn := json.RawMessage(msg.Data)
    	bytes, err := rawIn.MarshalJSON()
    	if err != nil {
			log.Println(err)
			return
   		 }


    	
		d := &ArgData{}
		err = json.Unmarshal(bytes, &d)
		if err!=nil{
			log.Println("error in parsing Argument Json Data object:",err)
			return
		}
		//run each child process for the script in a seperate go routine
		go func(){
			paths,err := db.GetPaths(d.Token)
			if err==nil{
				runScripts(d.Data,paths)
			}
		}()
			
		
	})

	if err!=nil{
		log.Println("Cannot connect to SSE server: "+err.Error())
	}

}

//NewSSeClient ... create a new SSE clie nt and then  run go subscribe
func NewSSeClient(endpoint string)*SSEClient{
	
	sc :=  &SSEClient{}
	sc.client = sse.NewClient(endpoint)
	return sc
}

func runScripts(d string,paths []string){
	for _,v := range paths{

		if strings.HasSuffix(v,".js"){
			go runCommand(d,v,RUNJS)
		}else if strings.HasSuffix(v,".py"){
			go runCommand(d,v,RUNPY)
		}else{
			log.Printf("unsupported script file extension at path:%s",v)
		}
	}
}
//run the passed script file at the  provided path
func runCommand(data string, scriptpath string,command string){
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Second)
    defer cancel()

	dir, err := os.Getwd()
	if err != nil {
		log.Println("unable to get current working directory:",err)
		return
	}
	//actualpath := scriptpath
	proc := exec.CommandContext(ctx,command,[]string{scriptpath,data}...)
	//proc.Path = cmdPath
	proc.Stdin = os.Stdin
	proc.Stdout = os.Stdout
	proc.Stderr = os.Stderr
	proc.Env = nil
	proc.Dir = dir + "/scripts"
	err = proc.Run()
	log.Println("ran script at path ",scriptpath," with error:" ,err)
}