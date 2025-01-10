FROM debian:12

ENV DEBIAN_FRONTEND noninteractive

RUN echo "LC_ALL=en_US.UTF-8" >> /etc/environment
RUN echo "en_US.UTF-8 UTF-8" >> /etc/locale.gen
RUN echo "LANG=en_US.UTF-8" > /etc/locale.conf

RUN apt-get update && apt-get upgrade -y

RUN apt-get install -y locales zsh lsb-release wget curl tar git sed sudo zip nmap iputils-ping dnsutils bsdmainutils python3 python3-pip python3-venv
RUN locale-gen en_US.UTF-8

RUN mkdir /server
RUN mkdir /data

RUN mkdir -p /home/user/

COPY . /server/

RUN chmod +x /server/run.sh

RUN ls -al /server/*
