Item {
	anchors.fill: parent
	Column {
		width: parent.width
		height: parent.height
		spacing: 0

		Item {
			width: 450
			height: 92
			Rectangle {
				width: parent.width
				height: parent.height - 10
				color: "#141414"
				radius: 5
				Column {
					x: 12
					y: 10
					width: parent.width - 24
					spacing: 4
					Text {
						color: theme.primarytextcolor
						text: "WLED over UDP"
						font.pixelSize: 16
						font.family: "Poppins"
						font.bold: true
					}
					Text {
						width: parent.width
						color: theme.primarytextcolor
						wrapMode: Text.WordWrap
						font.pixelSize: 12
						font.family: "Poppins"
						text: "Talks only UDP realtime (port 21324 / DNRGB). No port 80, no /json API, no web_server needed.<br>ESPHome: add <b>effects: - wled:</b> to your addressable light and select that effect."
					}
				}
			}
		}

		Item {
			width: 450
			height: 104
			Rectangle {
				width: parent.width
				height: parent.height - 10
				color: "#141414"
				radius: 5
				Column {
					x: 12
					y: 10
					width: parent.width - 24
					spacing: 6
					Text {
						color: theme.primarytextcolor
						text: "Add device by IP"
						font.pixelSize: 14
						font.family: "Poppins"
						font.bold: true
					}
					Row {
						spacing: 6
						TextField {
							id: inputIP
							width: 150
							height: 34
							leftPadding: 8
							rightPadding: 8
							color: theme.primarytextcolor
							font.family: "Poppins"
							font.bold: true
							font.pixelSize: 14
							verticalAlignment: TextInput.AlignVCenter
							placeholderText: "192.168.0.50"
							background: Rectangle {
								radius: 5
								color: "#0d0d0d"
								border.color: "#1c1c1c"
								border.width: 2
							}
							validator: RegularExpressionValidator {
								regularExpression: /^((?:[0-1]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])\.){3}(?:[0-1]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])$/
							}
						}
						TextField {
							id: inputPort
							width: 82
							height: 34
							leftPadding: 8
							rightPadding: 8
							color: theme.primarytextcolor
							font.family: "Poppins"
							font.pixelSize: 14
							verticalAlignment: TextInput.AlignVCenter
							text: "21324"
							background: Rectangle {
								radius: 5
								color: "#0d0d0d"
								border.color: "#1c1c1c"
								border.width: 2
							}
							validator: IntValidator { bottom: 1; top: 65535 }
						}
						TextField {
							id: inputLeds
							width: 82
							height: 34
							leftPadding: 8
							rightPadding: 8
							color: theme.primarytextcolor
							font.family: "Poppins"
							font.pixelSize: 14
							verticalAlignment: TextInput.AlignVCenter
							placeholderText: "60"
							background: Rectangle {
								radius: 5
								color: "#0d0d0d"
								border.color: "#1c1c1c"
								border.width: 2
							}
							validator: IntValidator { bottom: 1; top: 2000 }
						}
						Item {
							width: 78
							height: 34
							Rectangle {
								anchors.fill: parent
								radius: 5
								color: addMouse.containsMouse ? "#2b5bff" : "#003EFF"
								Text {
									anchors.centerIn: parent
									color: "#ffffff"
									text: "Add"
									font.pixelSize: 14
									font.family: "Poppins"
									font.bold: true
								}
								MouseArea {
									id: addMouse
									anchors.fill: parent
									hoverEnabled: true
									onClicked: {
										discovery.forceDiscover(inputIP.text, inputPort.text, inputLeds.text, "");
									}
								}
							}
						}
					}
					Text {
						color: "#8a8a8a"
						text: "IP  ·  UDP port  ·  LED count"
						font.pixelSize: 11
						font.family: "Poppins"
					}
				}
			}
		}

		ListView {
			id: controllerList
			model: service.controllers
			width: 450
			height: parent.height - 200
			clip: true

			ScrollBar.vertical: ScrollBar {
				anchors.right: parent.right
				width: 10
				policy: ScrollBar.AlwaysOn
				contentItem: Rectangle {
					radius: parent.width / 2
					color: theme.scrollBar
				}
			}

			delegate: Item {
				width: 450
				height: 118
				property var device: model.modelData.obj

				Rectangle {
					width: parent.width
					height: parent.height - 10
					color: device.connected ? "#003EFF" : "#292929"
					radius: 5
				}

				Column {
					x: 12
					y: 8
					width: parent.width - 160
					spacing: 5

					Text {
						color: theme.primarytextcolor
						text: device.name
						font.pixelSize: 16
						font.family: "Poppins"
						font.bold: true
					}
					Text {
						color: theme.primarytextcolor
						text: device.ip + " : " + device.udpPort
						font.pixelSize: 12
						font.family: "Poppins"
					}
					Row {
						spacing: 6
						Text {
							anchors.verticalCenter: parent.verticalCenter
							color: theme.primarytextcolor
							text: "LEDs"
							font.pixelSize: 12
							font.family: "Poppins"
						}
						TextField {
							id: ledField
							width: 64
							height: 26
							leftPadding: 6
							rightPadding: 6
							color: theme.primarytextcolor
							text: device.deviceledcount
							font.pixelSize: 12
							font.family: "Poppins"
							verticalAlignment: TextInput.AlignVCenter
							background: Rectangle {
								radius: 4
								color: "#0d0d0d"
							}
							validator: IntValidator { bottom: 1; top: 2000 }
							onEditingFinished: {
								device.setLedCount(ledField.text);
							}
						}
					}
				}

				Column {
					x: 300
					y: 10
					spacing: 8

					Item {
						width: 128
						height: 30
						Rectangle {
							anchors.fill: parent
							radius: 5
							color: linkMouse.containsMouse ? "#1f4fff" : (device.connected ? "#292929" : "#0f8a3d")
							Text {
								anchors.centerIn: parent
								color: "#ffffff"
								text: device.connected ? "Unlink" : "Link"
								font.pixelSize: 13
								font.family: "Poppins"
								font.bold: true
							}
							MouseArea {
								id: linkMouse
								anchors.fill: parent
								hoverEnabled: true
								onClicked: {
									if (device.connected) {
										device.startRemove();
									} else {
										device.startLink();
									}
								}
							}
						}
					}

					Row {
						spacing: 8

						Item {
							width: 60
							height: 26
							Rectangle {
								anchors.fill: parent
								radius: 5
								color: onMouse.containsMouse ? "#3a3a3a" : "#1c1c1c"
								Text {
									anchors.centerIn: parent
									color: theme.primarytextcolor
									text: "On"
									font.pixelSize: 12
									font.family: "Poppins"
								}
								MouseArea {
									id: onMouse
									anchors.fill: parent
									hoverEnabled: true
									onClicked: device.turnOn()
								}
							}
						}

						Item {
							width: 60
							height: 26
							Rectangle {
								anchors.fill: parent
								radius: 5
								color: offMouse.containsMouse ? "#3a3a3a" : "#1c1c1c"
								Text {
									anchors.centerIn: parent
									color: theme.primarytextcolor
									text: "Off"
									font.pixelSize: 12
									font.family: "Poppins"
								}
								MouseArea {
									id: offMouse
									anchors.fill: parent
									hoverEnabled: true
									onClicked: device.turnOff()
								}
							}
						}
					}
				}

				Item {
					x: 410
					y: 10
					width: 26
					height: 26
					visible: device.forced
					Rectangle {
						anchors.fill: parent
						radius: 5
						color: delMouse.containsMouse ? "#8a1010" : "#2a1010"
						Text {
							anchors.centerIn: parent
							color: "#ff6b6b"
							text: "×"
							font.pixelSize: 16
							font.bold: true
						}
						MouseArea {
							id: delMouse
							anchors.fill: parent
							hoverEnabled: true
							onClicked: device.startDelete()
						}
					}
				}
			}
		}
	}
}
