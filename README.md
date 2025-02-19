# Device service

PORT = 3034
Database = 5435

```sh
docker run -d --name kpress-db-device -e POSTGRES_USER=myuser -e POSTGRES_PASSWORD=mypassword -e POSTGRES_DB=mydb --expose 5435 -p 5435:5435 --health-cmd="pg_isready -U myuser -d mydb -p 5435" --health-interval=10s --health-timeout=5s --health-retries=5 postgres:latest postgres -c port=5435
```


```sh
docker run -d --name kpress-rabbitmq -p 5552:5552 -p 15672:15672 -p 5672:5672 -e RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS=-rabbitmq_stream advertised_host localhost rabbitmq:3.13 sh -c "rabbitmq-plugins enable rabbitmq_stream rabbitmq_stream_management && rabbitmq-server"
```