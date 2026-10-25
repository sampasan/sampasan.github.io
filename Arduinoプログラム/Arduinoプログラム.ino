  #include<LedControl.h>

  #define DATAPIN 11
  #define CLKPIN 13
  #define CSPIN 10

LedControl lc(DATAPIN, CLKPIN, CSPIN,1);

int val = 0;
int pattern[65] = {0};
int patnum = 0;
int row0[8] = {0};
int row1[8] = {0};
int row2[8] = {0};
int row3[8] = {0};
int row4[8] = {0};
int row5[8] = {0};
int row6[8] = {0};
int row7[8] = {0};
int *rows[]={row0,row1,row2,row3,row4,row5,row6,row7};
int Errorflag = 0;
int needReDraw = 0;

String command = "";
bool waitingForSize = false;
bool waitingForPattern = false;
int displayResolution = 8;
char packet[65] = {0};

void setup() {
  Serial.begin(9600);
  lc.shutdown(0,false);//スリープ解除
  lc.setIntensity(0,1);//明るさ（0~15）
  lc.clearDisplay(0);//表示クリア
  lc.setScanLimit(0,7);//8行すべて使用
}
void loop() {
  if(Serial.available()>0){//点灯パターン更新
    command = Serial.readStringUntil('\n');
    command.trim();

    if(command == "ok?"){//ハンドシェイク
      Serial.println("OK!");
      waitingForSize = true;
      waitingForPattern = false;
      return;
    }

    if(waitingForSize){
      if(command == "size:8x8") displayResolution = 8;
      else if(command == "size:4x4") displayResolution = 4;
      else if(command == "size:2x2") displayResolution = 2;
      else if(command == "size:1x1") displayResolution = 1;
      else {
        Serial.println("!!!Invalid size!!!");
        return;
      }
      Serial.print("SIZE OK! ");
      Serial.println(displayResolution);
      waitingForSize = false;
      waitingForPattern = true;
      return;
    }

    if(waitingForPattern){//パターン更新
      int expectedLength = displayResolution * displayResolution;
      if(command.length() != expectedLength){
        Serial.print("!!!Invalid pattern length: expected ");
        Serial.print(expectedLength);
        Serial.print(", received ");
        Serial.print(command.length());
        Serial.println("!!!");
        return;
      }

      bool validPattern = true;
      for(int i = 0; i < expectedLength; i++){
        if(command[i] != '0' && command[i] != '1'){
          validPattern = false;
          break;
        }
      }
      if(!validPattern){
        Serial.println("!!!Prease Retry!!!");
        return;
      }

      int blockSize = 8 / displayResolution;
      for(int y = 0; y < 8; y++){
        for(int x = 0; x < 8; x++){
          int sourceX = x / blockSize;
          int sourceY = y / blockSize;
          int sourceIndex = sourceY * displayResolution + sourceX;
          packet[y * 8 + x] = command[sourceIndex];
        }
      }
      packet[64] = '\0';
      reset64();
      newpattern();
      if (Errorflag == 0){
        trans8();
        draw();//点灯
      }
      waitingForPattern = false;
      needReDraw = 1;
      return;
    }
  }
  if(needReDraw == 1){//点灯パターン更新後に再描画
    draw();//点灯
    needReDraw = 0;
  }
}

void reset64(){
  for(int i = 0; i != 65; i++){
    pattern[i] = 0;
  }
}

void newpattern(){
  patnum = 0;

  if(packet[64] != '\0'){
    Errorflag = 1;
    Serial.println("!!!Prease Retry!!!");
    return;
  }

  for(int i = 0;i != 64;i++){
    if(packet[i] != '0' && packet[i] != '1'){
      Errorflag = 1;
      Serial.println("!!!Prease Retry!!!");
      return;
    }
    val = packet[i] - '0';
    // Serial.print("Input Number: ");
    // Serial.println(val);
    pattern[patnum] = val;
    patnum++;

    // Serial.print("now strings: ");
    // for(int j = 0; j < patnum; j++){
    //   Serial.print(pattern[j]);
    // }
    // Serial.println();
  }
  Errorflag = 0;
}

void trans8(){
  Serial.println();
  int rownum = 0;
  int col = 0;
  for(int i=0;i != 64;i++){
    rows[rownum][col] = pattern[i];
    col++;
    if(col == 8){
      rownum++;
      col = 0;
    }
  }
  for(int j = 0;j !=8;j++){
    Serial.print("row");
    Serial.print(j);
    Serial.print(":");
    for(int k = 0; k != 8;k++){
      Serial.print(rows[j][k]);
    }
    Serial.println();
  }
}

void draw() {
  lc.clearDisplay(0);
  for (int i = 0; i < 8; i++) {
    byte rowBits = 0;
    for (int j = 0; j < 8; j++) {
      if (rows[i][j] != 0) {
        rowBits |= (1 << j);
      }
    }
    lc.setRow(0, 7 - i, rowBits);
  }
}
