## phase 0 - infra
[ ] add telemetry
[x] util/logger: review shorten code; add project name from hook.

## phase 1: MVP
[ ] new l-guardrail server app: clone the http.template folder
[ ] hook API w tellemetry
[ ] source ip matching
[ ] healthcheck api with stats output
[ ] new l-router under components with a nop implementation
[ ] load config.yaml, load CustomRouter
[ ] session keys, inject session-id into history
[ ] session store in redis, TTLs
[ ] circuitbreaker: implement fail-open on queue
[ ] log data before and after + stats
[ ] downstream request breakdown and assembly with memory
[ ] crusher: conter router 
[ ] crusher: headroom filters
[ ] docker + testing
[ ] build & release pipelines
[ ] docs
[ ] load test
[ ] sbom

## phase 2
[ ] new cli: clone cli.template
[ ] new cli 'option' command set/get/getall values from config.yaml
[ ] new cli 'option --reload' command calls a new server api to reload config.yaml
[ ] upstream filter
[ ] upstream request breakdown and assembly with memory
[ ] OpenWolF Cerebrum
[ ] OpenWolf Anatomy

## phase 3 
[ ] Licesnse: time, tokens
[ ] suggest compact to user
[ ] longer term session